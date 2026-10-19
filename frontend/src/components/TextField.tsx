import { StyleSheet, TextInput, TextInputProps, View } from "react-native";
import { AppText } from "./AppText";
import { colors, spacing } from "@/theme";

type Props = TextInputProps & {
  label: string;
};

export function TextField({ label, style, ...props }: Props) {
  return (
    <View style={styles.group}>
      <AppText variant="small" muted>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm
  },
  input: {
    minHeight: 48,
    borderRadius: 36,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15
  }
});
