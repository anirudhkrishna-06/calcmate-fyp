import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { colors, spacing } from "@/theme";
import type { GraphConceptNode, CurriculumGraphData } from "@/services/curriculumGraphService";

interface Props {
  graph: CurriculumGraphData;
  selectedConceptId: string | null;
  onSelectConcept: (conceptId: string) => void;
  overlayMode?: "none" | "student" | "group";
}

export function KnowledgeGraphVisualizer({
  graph,
  selectedConceptId,
  onSelectConcept,
  overlayMode = "none"
}: Props) {
  const [viewMode, setViewMode] = useState<"focused" | "layers" | "list">("focused");

  const selectedNode = graph.nodes.find(n => n.id === selectedConceptId) || graph.nodes[0] || null;

  // Immediate neighborhood of selected concept:
  const prereqNodes = selectedNode
    ? graph.nodes.filter(n => selectedNode.prerequisiteIds.includes(n.id))
    : [];
  const dependentNodes = selectedNode
    ? graph.nodes.filter(n => selectedNode.dependentIds.includes(n.id))
    : [];

  // Group nodes by depth for layer view
  const nodesByDepth: Record<number, GraphConceptNode[]> = {};
  for (const n of graph.nodes) {
    if (!nodesByDepth[n.depth]) nodesByDepth[n.depth] = [];
    nodesByDepth[n.depth].push(n);
  }
  const depths = Object.keys(nodesByDepth).map(Number).sort((a, b) => a - b);

  function getNodeStatusColor(node: GraphConceptNode) {
    if (overlayMode === "none") {
      return { border: colors.primary, bg: colors.surface, text: colors.forest, badge: "Curriculum" };
    }
    if (node.stateStatus === "likely_ready") {
      return { border: colors.forest, bg: colors.sageLight, text: colors.forest, badge: "Likely Ready" };
    }
    if (node.stateStatus === "needs_support") {
      return { border: colors.danger, bg: "#fee2e2", text: colors.danger, badge: "Needs Revision" };
    }
    if (node.stateStatus === "insufficient") {
      return { border: colors.attention, bg: "#fef3c7", text: colors.attention, badge: "Developing" };
    }
    return { border: colors.border, bg: colors.surface, text: colors.textMuted, badge: "Unknown / No marks" };
  }

  function renderConceptCard(node: GraphConceptNode, role: "selected" | "prereq" | "dependent" | "layer") {
    const isSelected = node.id === selectedConceptId;
    const styleInfo = getNodeStatusColor(node);

    return (
      <Pressable
        key={node.id}
        accessibilityRole="button"
        accessibilityLabel={`${node.id}: ${node.title}, Grade ${node.grade}, ${styleInfo.badge}`}
        onPress={() => onSelectConcept(node.id)}
        style={({ pressed }) => [
          styles.nodeCard,
          {
            borderColor: isSelected ? colors.primary : styleInfo.border,
            borderWidth: isSelected ? 2 : 1,
            backgroundColor: isSelected ? colors.sageLight : styleInfo.bg,
            opacity: pressed ? 0.8 : 1
          }
        ]}
      >
        <View style={styles.nodeHeaderRow}>
          <View style={styles.nodeIdBadge}>
            <AppText style={styles.nodeIdText}>{node.id}</AppText>
          </View>
          <View style={[styles.gradeBadge, { backgroundColor: colors.forest }]}>
            <AppText style={styles.gradeBadgeText}>Gr {node.grade}</AppText>
          </View>
          {node.prerequisiteGap ? (
            <View style={styles.gapWarningBadge}>
              <AppText style={styles.gapWarningText}>⚠️ Gap</AppText>
            </View>
          ) : null}
        </View>

        <AppText style={styles.nodeTitle} numberOfLines={2}>
          {node.title}
        </AppText>

        {overlayMode !== "none" ? (
          <View style={styles.nodeMetaRow}>
            <AppText variant="small" style={{ color: styleInfo.text, fontWeight: "700" }}>
              {node.masteryEstimate !== null ? `${Math.round(node.masteryEstimate * 100)}%` : "No marks"}
            </AppText>
            <AppText variant="small" muted>
              · {styleInfo.badge}
            </AppText>
          </View>
        ) : (
          <AppText variant="small" muted>
            {node.prerequisiteIds.length ? `${node.prerequisiteIds.length} prereq` : "Root concept"} · {node.dependentIds.length} downstream
          </AppText>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      {/* Visualizer Mode Toggle */}
      <View style={styles.toggleRow}>
        <Button
          label="Focused Graph"
          variant={viewMode === "focused" ? "primary" : "quiet"}
          onPress={() => setViewMode("focused")}
          style={{ flex: 1 }}
        />
        <Button
          label="Sequence Layers"
          variant={viewMode === "layers" ? "primary" : "quiet"}
          onPress={() => setViewMode("layers")}
          style={{ flex: 1 }}
        />
        <Button
          label="Structured List"
          variant={viewMode === "list" ? "primary" : "quiet"}
          onPress={() => setViewMode("list")}
          style={{ flex: 1 }}
        />
      </View>

      {/* 1. FOCUSED GRAPH VIEW */}
      {viewMode === "focused" && selectedNode ? (
        <View style={styles.focusedContainer}>
          {/* Prerequisites column / row */}
          <View style={styles.flowSection}>
            <View style={styles.flowHeader}>
              <AppText variant="small" style={styles.flowLabel}>
                REQUIRED PREREQUISITES ({prereqNodes.length})
              </AppText>
              <AppText variant="small" muted>Foundation must be secure first</AppText>
            </View>
            {prereqNodes.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" contentContainerStyle={styles.cardsRow}>
                {prereqNodes.map(n => renderConceptCard(n, "prereq"))}
              </ScrollView>
            ) : (
              <View style={styles.emptyPrereqBox}>
                <AppText variant="small" muted>
                  No prior prerequisites · Foundational curriculum root
                </AppText>
              </View>
            )}
          </View>

          {/* Directed Flow Arrow */}
          <View style={styles.arrowContainer}>
            <View style={styles.arrowLine} />
            <View style={styles.arrowPill}>
              <AppText style={styles.arrowText}>▼ Prerequisite of ▼</AppText>
            </View>
            <View style={styles.arrowLine} />
          </View>

          {/* Target Selected Concept */}
          <View style={styles.focusedTargetBox}>
            <View style={styles.targetLabelRow}>
              <AppText variant="subheading" style={{ color: colors.forest }}>
                TARGET CONCEPT (INSPECTION FOCUS)
              </AppText>
              <AppText variant="small" muted>Tap to switch</AppText>
            </View>
            {renderConceptCard(selectedNode, "selected")}
          </View>

          {/* Directed Flow Arrow */}
          <View style={styles.arrowContainer}>
            <View style={styles.arrowLine} />
            <View style={styles.arrowPill}>
              <AppText style={styles.arrowText}>▼ Enables Downstream ▼</AppText>
            </View>
            <View style={styles.arrowLine} />
          </View>

          {/* Dependent downstream concepts */}
          <View style={styles.flowSection}>
            <View style={styles.flowHeader}>
              <AppText variant="small" style={styles.flowLabel}>
                DOWNSTREAM DEPENDENTS ({dependentNodes.length})
              </AppText>
              <AppText variant="small" muted>Concepts unlocked by this topic</AppText>
            </View>
            {dependentNodes.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" contentContainerStyle={styles.cardsRow}>
                {dependentNodes.map(n => renderConceptCard(n, "dependent"))}
              </ScrollView>
            ) : (
              <View style={styles.emptyPrereqBox}>
                <AppText variant="small" muted>
                  Terminal topic for Grade {selectedNode.grade}
                </AppText>
              </View>
            )}
          </View>
        </View>
      ) : null}

      {/* 2. SEQUENCE LAYERS VIEW */}
      {viewMode === "layers" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" style={styles.layersScroll}>
          <View style={styles.layersContainer}>
            {depths.map(depth => (
              <View key={depth} style={styles.depthColumn}>
                <View style={styles.depthHeader}>
                  <AppText variant="small" style={styles.depthTitle}>
                    {depth === 0 ? "Tier 1: Roots" : `Tier ${depth + 1}: Sequenced`}
                  </AppText>
                  <AppText variant="small" muted>
                    {nodesByDepth[depth].length} topics
                  </AppText>
                </View>
                <ScrollView showsVerticalScrollIndicator contentContainerStyle={{ gap: 8, paddingBottom: 16 }}>
                  {nodesByDepth[depth].map(node => renderConceptCard(node, "layer"))}
                </ScrollView>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {/* 3. STRUCTURED LIST FALLBACK */}
      {viewMode === "list" ? (
        <View style={{ gap: 8 }}>
          {graph.nodes.map(node => {
            const isSelected = node.id === selectedConceptId;
            const styleInfo = getNodeStatusColor(node);
            return (
              <Pressable
                key={node.id}
                accessibilityRole="button"
                accessibilityLabel={`${node.id}: ${node.title}`}
                onPress={() => onSelectConcept(node.id)}
                style={[
                  styles.listRow,
                  isSelected && { borderColor: colors.primary, backgroundColor: colors.sageLight }
                ]}
              >
                <View style={{ width: 56 }}>
                  <AppText style={{ fontWeight: "700", color: colors.primary }}>{node.id}</AppText>
                  <AppText variant="small" muted>Gr {node.grade}</AppText>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText style={{ fontWeight: "600" }}>{node.title}</AppText>
                  <AppText variant="small" muted>
                    {node.prerequisiteIds.length ? `Requires: ${node.prerequisiteIds.join(", ")}` : "Root concept"}
                  </AppText>
                </View>
                {node.prerequisiteGap ? (
                  <View style={styles.gapWarningBadge}>
                    <AppText style={styles.gapWarningText}>⚠️ Gap</AppText>
                  </View>
                ) : (
                  <View style={[styles.statusTag, { backgroundColor: styleInfo.bg, borderColor: styleInfo.border }]}>
                    <AppText style={[styles.statusTagText, { color: styleInfo.text }]}>
                      {node.masteryEstimate !== null ? `${Math.round(node.masteryEstimate * 100)}%` : styleInfo.badge}
                    </AppText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md
  },
  toggleRow: {
    flexDirection: "row",
    gap: 6
  },
  focusedContainer: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 12
  },
  flowSection: {
    gap: 6
  },
  flowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  flowLabel: {
    fontWeight: "700",
    color: colors.forest,
    fontSize: 11,
    letterSpacing: 0.5
  },
  cardsRow: {
    gap: 8,
    paddingVertical: 4
  },
  emptyPrereqBox: {
    padding: 10,
    backgroundColor: "#f8fafc",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center"
  },
  arrowContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  arrowLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border
  },
  arrowPill: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.forest
  },
  arrowText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.forest
  },
  focusedTargetBox: {
    gap: 6,
    padding: 10,
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary
  },
  targetLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  nodeCard: {
    width: 170,
    minHeight: 110,
    padding: 10,
    borderRadius: 6,
    justifyContent: "space-between",
    gap: 4
  },
  nodeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  nodeIdBadge: {
    backgroundColor: colors.charcoal,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  nodeIdText: {
    color: colors.white,
    fontWeight: "800",
    fontSize: 11
  },
  gradeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  gradeBadgeText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 10
  },
  gapWarningBadge: {
    backgroundColor: "#fef3c7",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.attention
  },
  gapWarningText: {
    color: colors.attention,
    fontWeight: "800",
    fontSize: 10
  },
  nodeTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text
  },
  nodeMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  layersScroll: {
    maxHeight: 380
  },
  layersContainer: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 4
  },
  depthColumn: {
    width: 180,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    gap: 8
  },
  depthHeader: {
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingBottom: 6
  },
  depthTitle: {
    fontWeight: "700",
    color: colors.forest
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1
  },
  statusTagText: {
    fontWeight: "700",
    fontSize: 11
  }
});

