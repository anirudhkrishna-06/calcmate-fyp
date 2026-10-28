import { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { StudentKnowledgeView } from "@/services/learnerStateService";
import { colors } from "@/theme";

type Props = {
  studentName: string;
  grade: number;
  knowledge: StudentKnowledgeView | null;
  onSubmit: (question: string, conceptId?: string) => void;
};

export function StudentAiBar({ studentName, grade, knowledge, onSubmit }: Props) {
  const [value, setValue] = useState("");
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
  function submit(question = value) {
    const trimmed = question.trim();
    if (!trimmed) return;
    const conceptId = question === suggestions[0] ? focus?.concept_id : undefined;
    setValue("");
    onSubmit(trimmed, conceptId);
  }
  return (
    <View style={styles.shell}>
      <View style={styles.inputRow}>
        <View style={styles.sparkle}><Ionicons name="sparkles" size={18} color={colors.gold} /></View>
        <TextInput
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => submit()}
          returnKeyType="send"
          placeholder={`Ask Calcmate about ${studentName}...`}
          placeholderTextColor={colors.charcoalMuted}
          accessibilityLabel={`Ask Calcmate about ${studentName}`}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask student Copilot"
          accessibilityState={{ disabled: !value.trim() }}
          disabled={!value.trim()}
          onPress={() => submit()}
          style={[styles.send, value.trim() ? styles.sendActive : styles.sendIdle]}
        >
          <Ionicons name="arrow-forward" size={18} color={colors.white} />
        </Pressable>
      </View>
      <View style={styles.subheading}>
        <Text style={styles.modeLabel}>{studentName} · Grade {grade} Copilot</Text>
        <Text style={styles.helper}>Answers use this learner's recorded evidence.</Text>
      </View>
      <View style={styles.chips}>
        {suggestions.map((suggestion, index) => (
          <Pressable key={suggestion} accessibilityRole="button" onPress={() => submit(suggestion)} style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}>
            <Ionicons name={index === 0 ? "flash-outline" : index === 1 ? "git-branch-outline" : "arrow-forward-circle-outline"} size={14} color={colors.forest} />
            <Text style={styles.chipText}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.paper, shadowColor: colors.forest, shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3, gap: 12 },
  inputRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 10, paddingRight: 6, borderRadius: 26, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paperWarm },
  sparkle: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.goldLight },
  input: { flex: 1, minHeight: 42, color: colors.charcoal, fontSize: 14 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  sendActive: { backgroundColor: colors.forest },
  sendIdle: { backgroundColor: colors.line },
  subheading: { gap: 2 },
  modeLabel: { color: colors.forest, fontWeight: "800", fontSize: 12 },
  helper: { color: colors.charcoalMuted, fontSize: 11 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.sageLight, borderWidth: 1, borderColor: colors.lineLight, maxWidth: "100%" },
  chipPressed: { backgroundColor: colors.goldLight },
  chipText: { color: colors.charcoal, fontSize: 11.5, flexShrink: 1 },
});
