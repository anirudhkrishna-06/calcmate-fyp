import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './AppText';
import { colors } from '@/theme';

export function ClassFlow({ step }: { step: 0 | 1 | 2 }) {
  return <View style={styles.flow}>{['Prepare', 'Teach', 'Review'].map((label, index) => (
    <View key={label} style={[styles.step, index === step && styles.selected]}>
      <Ionicons name={index < step ? 'checkmark-circle' : index === 0 ? 'sunny-outline' : index === 1 ? 'school-outline' : 'checkmark-done-outline'} size={16} color={index === step ? colors.white : colors.forest} />
      <AppText style={[styles.stepLabel, index === step && { color: colors.white }]}>{label}</AppText>
    </View>
  ))}</View>;
}

export function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <View style={styles.details}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={styles.trigger}>
      <AppText style={styles.detailLabel}>{title}</AppText>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.forest} />
    </Pressable>
    {open && <View style={styles.detailBody}>{children}</View>}
  </View>;
}

const styles = StyleSheet.create({
  flow: { flexDirection: 'row', padding: 4, borderRadius: 18, backgroundColor: colors.sageLight, gap: 4 },
  step: { flex: 1, minHeight: 40, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, borderRadius: 14 },
  selected: { backgroundColor: colors.forest },
  stepLabel: { fontSize: 12, fontWeight: '700', color: colors.forest },
  details: { borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  trigger: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.forest },
  detailBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
});
