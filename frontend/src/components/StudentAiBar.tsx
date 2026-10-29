import { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StudentKnowledgeView } from "@/services/learnerStateService";
import { colors } from "@/theme";

type Props = {
  studentName: string;
  grade: number;
  knowledge: StudentKnowledgeView | null;
  onSubmit: () => void;
};

export function StudentAiBar({ studentName, grade, knowledge, onSubmit }: Props) {
  const focus = useMemo(
    () => knowledge?.concepts.find(c => c.state?.state_status === "needs_support") ?? knowledge?.concepts.find(c => c.prerequisite_gap),
    [knowledge],
  );
  const suggestions = [
    ...(focus ? [`Why is ${studentName} struggling with ${focus.concept_title}?`] : []),
    ...(knowledge?.concepts.some(c => c.prerequisite_gap) ? ["Show the foundational gaps"] : []),
    ...(knowledge?.concepts.some(c => !c.state || c.state.state_status === "unknown") ? ["What has not been assessed yet?"] : []),
    `What should I teach ${studentName} next?`,
  ].slice(0, 4);
  return (
    <View style={styles.shell}>
      <Pressable accessibilityRole="button" onPress={() => onSubmit()} style={({pressed}) => [styles.openRow,pressed&&styles.chipPressed]}>
        <View style={styles.openIcon}><Ionicons name="sparkles" size={18} color={colors.forest}/></View>
        <View style={{flex:1,gap:3}}><Text style={styles.openTitle}>Open StudentAI</Text><Text style={styles.helper}>A private teaching assistant for {studentName}</Text></View>
        <Ionicons name="arrow-forward" size={18} color={colors.forest}/>
      </Pressable>
      <View style={styles.subheading}>
        <Text style={styles.modeLabel}>{studentName} · Grade {grade} StudentAI</Text>
        <Text style={styles.helper}>Answers use this learner's recorded evidence.</Text>
      </View>
      <View style={styles.chips}>{suggestions.map((suggestion,index)=><View key={suggestion} style={styles.chip}><Ionicons name={index===0?"flash-outline":"arrow-forward-circle-outline"} size={14} color={colors.forest}/><Text style={styles.chipText}>{suggestion}</Text></View>)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.paper, shadowColor: colors.forest, shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3, gap: 12 },
  openRow:{minHeight:58,flexDirection:"row",alignItems:"center",gap:12,paddingHorizontal:12,borderRadius:14,borderWidth:1,borderColor:colors.line,backgroundColor:colors.paperWarm},
  openIcon:{width:36,height:36,borderRadius:18,alignItems:"center",justifyContent:"center",backgroundColor:colors.goldLight},
  openTitle:{fontSize:14,fontWeight:"800",color:colors.forest},
  subheading: { gap: 2 },
  modeLabel: { color: colors.forest, fontWeight: "800", fontSize: 12 },
  helper: { color: colors.charcoalMuted, fontSize: 11 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.sageLight, borderWidth: 1, borderColor: colors.lineLight, maxWidth: "100%" },
  chipPressed: { backgroundColor: colors.goldLight },
  chipText: { color: colors.charcoal, fontSize: 11.5, flexShrink: 1 },
});
