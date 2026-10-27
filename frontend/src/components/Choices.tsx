
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppText } from "./AppText";
import { colors } from "@/theme";

type Choice = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function Choices({
  values,
  selected,
  onSelect,
  multiple = false,
}: {
  values: Choice[];
  selected: string[];
  onSelect: (value: string) => void;
  multiple?: boolean;
}) {
  return (
    <View style={styles.container}>
      {values.map((item, index) => {
        const isSelected = selected.includes(item.value);
        const isDisabled = Boolean(item.disabled);

        return (
          <Pressable
            key={item.value}
            disabled={isDisabled}
            accessibilityRole={multiple ? "checkbox" : "radio"}
            accessibilityLabel={item.label}
            accessibilityState={{
              selected: isSelected,
              checked: multiple ? isSelected : undefined,
              disabled: isDisabled,
            }}
            onPress={() => onSelect(item.value)}
            style={({ pressed }) => [
              styles.choice,
              isSelected && styles.choiceSelected,
              isDisabled && styles.choiceDisabled,
              pressed && !isDisabled && styles.choicePressed,
            ]}
          >
            

            <AppText
              style={[
                styles.label,
                isSelected && styles.labelSelected,
              ]}
            >
              {item.label}
            </AppText>

            
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginVertical: 8,
  },

  choice: {
    minHeight: 52,
    flexGrow: 1,
    flexBasis: "28%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#FFFFFF",
  },

  choiceSelected: {
    backgroundColor: "#E8F0E5",
    borderColor: colors.forest,
    borderWidth: 1.5,
  },

  choiceDisabled: {
    opacity: 0.45,
  },

  choicePressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },

  numberBadge: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0EEE6",
  },

  numberBadgeSelected: {
    backgroundColor: colors.forest,
  },

  numberText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.charcoal,
  },

  numberTextSelected: {
    color: "#FFFFFF",
  },

  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.charcoal,
  },

  labelSelected: {
    color: colors.forest,
    fontWeight: "700",
  },

  selectionIndicator: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },

  selectionIndicatorSelected: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
});
