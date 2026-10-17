import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { GradeSelector } from "@/components/GradeSelector";
import { FormStatus } from "@/components/FormStatus";
import { Section } from "@/components/Workspace";
import { useLocalData } from "@/hooks/useLocalData";
import { colors, spacing } from "@/theme";
import {
  loadCurriculumGraph,
  overlayStudentState,
  overlayGroupState,
  getConceptExplanation,
  ConceptExplanation
} from "@/services/curriculumGraphService";
import { KnowledgeGraphVisualizer } from "@/components/KnowledgeGraphVisualizer";
import { loadStudents } from "@/services/storageService";
import { Student } from "@/types/domain";

export default function CurriculumKnowledgeGraphScreen() {
  const params = useLocalSearchParams<{
    grade?: string;
    conceptId?: string;
    studentId?: string;
    origin?: string;
  }>();

  const requestedGrade = params.grade ? Number(params.grade) : 0;
  const [selectedGrade, setSelectedGrade] = useState<number>([1, 2, 3, 4].includes(requestedGrade) ? requestedGrade : 0);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(
    params.conceptId || null
  );
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    params.studentId || null
  );
  const [overlayMode, setOverlayMode] = useState<"none" | "group" | "student">(
    params.studentId ? "student" : "group"
  );
  const [explanation, setExplanation] = useState<ConceptExplanation | null>(null);

  // 1. Load baseline graph and students
  const loader = useCallback(async () => {
    const loadedStudents = await loadStudents("", selectedGrade > 0 ? selectedGrade : undefined);
    let graphData = await loadCurriculumGraph(selectedGrade > 0 ? selectedGrade : undefined, "Math");

    if (overlayMode === "student" && selectedStudentId && loadedStudents.some(student => student.id === selectedStudentId)) {
      graphData = await overlayStudentState(graphData, selectedStudentId);
    } else if (overlayMode === "group" && selectedGrade > 0) {
      graphData = await overlayGroupState(graphData, selectedGrade);
    }

    return { graph: graphData, studentList: loadedStudents };
  }, [selectedGrade, overlayMode, selectedStudentId]);

  const { data, error, loading, reload } = useLocalData(loader);

  const students: Student[] = data?.studentList ?? [];
  const effectiveSelectedConceptId = data?.graph.nodes.some(node => node.id === selectedConceptId)
    ? selectedConceptId
    : data?.graph.nodes[0]?.id ?? null;

  // Load explanation whenever selected concept or grade changes
  useEffect(() => {
    let active = true;
    if (effectiveSelectedConceptId) {
      const g = selectedGrade > 0 ? selectedGrade : 3;
      void getConceptExplanation(effectiveSelectedConceptId, g)
        .then(exp => {
          if (active) setExplanation(exp);
        })
        .catch(() => {
          if (active) setExplanation(null);
        });
    }
    return () => {
      active = false;
    };
  }, [effectiveSelectedConceptId, selectedGrade]);

  const activeStudent = students.find(s => s.id === selectedStudentId);

  return (
    <Screen topInset={false}>
      {/* Header with Back button if origin passed */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <AppText variant="title">Curriculum Knowledge Graph</AppText>
          <AppText muted>
            NCERT mathematics prerequisite hierarchy & learner readiness
          </AppText>
        </View>
        {params.origin ? (
          <Button
            label="← Return"
            variant="quiet"
            onPress={() => router.back()}
          />
        ) : null}
      </View>

      <FormStatus message={error} error />
      {error ? <Button label="Retry curriculum" variant="secondary" onPress={reload} /> : null}

      {/* Grade Selector Filter */}
      <View style={{ gap: 6 }}>
        <AppText variant="small" muted>FILTER BY GRADE LEVEL</AppText>
        <GradeSelector
          grade={selectedGrade}
          onSelect={g => {
            setSelectedGrade(g);
            setSelectedConceptId(null);
            setSelectedStudentId(null);
          }}
        />
      </View>

      {/* Overlay Mode Selector */}
      <View style={styles.overlayBar}>
        <Button
          label="Curriculum Only"
          variant={overlayMode === "none" ? "primary" : "quiet"}
          onPress={() => {
            setOverlayMode("none");
            setSelectedStudentId(null);
          }}
          style={{ flex: 1 }}
        />
        <Button
          label={selectedGrade > 0 ? `Grade ${selectedGrade} Group` : "Class Group"}
          variant={overlayMode === "group" ? "primary" : "quiet"}
          onPress={() => {
            setOverlayMode("group");
            setSelectedStudentId(null);
          }}
          style={{ flex: 1 }}
        />
        <Button
          label="Student Overlay"
          variant={overlayMode === "student" ? "primary" : "quiet"}
          onPress={() => {
            setOverlayMode("student");
            if (students.length && !selectedStudentId) {
              setSelectedStudentId(students[0].id);
            }
          }}
          style={{ flex: 1 }}
        />
      </View>

      {/* Student Selector Bar if Student Overlay active */}
      {overlayMode === "student" && students.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" contentContainerStyle={styles.studentChipsRow}>
          {students.map(s => {
            const isSelected = s.id === selectedStudentId;
            return (
              <Button
                key={s.id}
                label={`Gr ${s.grade} · ${s.name}`}
                variant={isSelected ? "primary" : "secondary"}
                onPress={() => setSelectedStudentId(s.id)}
              />
            );
          })}
        </ScrollView>
      ) : null}

      {/* Interactive Visualizer */}
      {loading ? (
        <AppText muted>Loading canonical curriculum graph…</AppText>
      ) : data?.graph && data.graph.nodes.length > 0 ? (
        <KnowledgeGraphVisualizer
          graph={data.graph}
          selectedConceptId={effectiveSelectedConceptId}
          onSelectConcept={id => setSelectedConceptId(id)}
          overlayMode={overlayMode}
        />
      ) : data?.graph ? (
        <Section title="No curriculum concepts found" detail="The local curriculum has no active Math concepts for this filter.">
          <AppText muted>Try another grade or refresh the local workspace data.</AppText>
        </Section>
      ) : null}

      {/* Selected Concept Explanation & Diagnostic Insights (Increments 2 & 3) */}
      {explanation ? (
        <Section
          title={`${explanation.conceptId}: ${explanation.conceptTitle}`}
            detail={`Grade ${explanation.grade} ${explanation.subjectArea} · ${explanation.coverageStatus ?? "Curriculum concept"}`}
        >
          {explanation.learningObjective ? (
            <AppText variant="small" muted>Learning objective: {explanation.learningObjective}</AppText>
          ) : null}
          {/* Readiness & Diagnostic Banner */}
          <View
            style={[
              styles.readinessBanner,
              {
                borderColor: explanation.isReadyToTeach ? colors.forest : colors.attention,
                backgroundColor: explanation.isReadyToTeach ? colors.sageLight : "#fef3c7"
              }
            ]}
          >
            <AppText style={{ fontWeight: "700", color: explanation.isReadyToTeach ? colors.forest : colors.attention }}>
              {explanation.isReadyToTeach ? "✓ Ready for Instruction" : "⚠️ Foundational Revision Required"}
            </AppText>
            <AppText style={{ color: colors.charcoal, marginTop: 4 }}>
              {explanation.suggestedAction}
            </AppText>
            {explanation.gapReason ? (
              <AppText variant="small" style={{ color: colors.attention, marginTop: 4, fontWeight: "600" }}>
                {explanation.gapReason}
              </AppText>
            ) : null}
          </View>

          {/* Research Scheduler Explanation (Increment 3) */}
          {explanation.schedulerPriorityReason ? (
            <View style={styles.schedulerReasonBox}>
              <AppText variant="small" style={{ fontWeight: "700", color: colors.forest }}>
                SCHEDULER ATTENTION ALLOCATION RATIONALE:
              </AppText>
              <AppText variant="small" style={{ color: colors.charcoal, marginTop: 2 }}>
                {explanation.schedulerPriorityReason}
              </AppText>
            </View>
          ) : null}

          {/* Connected Prerequisites */}
          <View style={{ gap: 6 }}>
            <AppText style={{ fontWeight: "700", fontSize: 13 }}>
              Prerequisites ({explanation.prerequisites.length}):
            </AppText>
            {explanation.prerequisites.length > 0 ? (
              explanation.prerequisites.map(p => (
                <View key={p.id} style={styles.relationRow}>
                  <AppText style={{ fontWeight: "600", flex: 1 }}>{p.id}: {p.title}</AppText>
                  <AppText variant="small" style={{ fontWeight: "700", color: p.stateStatus === "likely_ready" ? colors.forest : colors.attention }}>
                    {p.mastery !== null && p.mastery !== undefined ? `${Math.round(p.mastery * 100)}%` : p.stateStatus || "Curriculum"}
                  </AppText>
                </View>
              ))
            ) : (
              <AppText variant="small" muted>Foundational concept with no prior prerequisites.</AppText>
            )}
          </View>

          {/* Unlocked Downstream Concepts */}
          <View style={{ gap: 6 }}>
            <AppText style={{ fontWeight: "700", fontSize: 13 }}>
              Enables Downstream ({explanation.dependents.length}):
            </AppText>
            {explanation.dependents.length > 0 ? (
              explanation.dependents.map(d => (
                <View key={d.id} style={styles.relationRow}>
                  <AppText style={{ fontWeight: "600", flex: 1 }}>{d.id}: {d.title}</AppText>
                  <AppText variant="small" muted>Grade {d.grade}</AppText>
                </View>
              ))
            ) : (
              <AppText variant="small" muted>Terminal concept for this grade band.</AppText>
            )}
          </View>

          {/* Action Row: Ask Copilot / Teach This Concept */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Button
              label="Ask Copilot"
              icon="chatbubble-ellipses-outline"
              variant="quiet"
              onPress={() =>
                router.push({
                  pathname: "/chatbot",
                  params: {
                    grade: String(explanation.grade),
                    conceptId: explanation.conceptId,
                    studentId: activeStudent?.id,
                    prompt: `Explain ${explanation.conceptTitle} for Grade ${explanation.grade} Maths. What are concrete prerequisite activities?`,
                    screenContext: "curriculum_graph"
                  }
                })
              }
              style={{ flex: 1 }}
            />
            <Button
              label="Plan Rotation"
              icon="calendar-outline"
              variant="secondary"
              onPress={() => router.push("/general-schedule/new")}
              style={{ flex: 1 }}
            />
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8
  },
  overlayBar: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 4
  },
  studentChipsRow: {
    gap: 6,
    paddingVertical: 4
  },
  readinessBanner: {
    padding: spacing.md,
    borderRadius: 8,
    borderLeftWidth: 4,
    gap: 2
  },
  schedulerReasonBox: {
    padding: 10,
    backgroundColor: colors.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border
  },
  relationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 8,
    backgroundColor: colors.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line
  }
});

