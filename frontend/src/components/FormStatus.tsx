import { AppText } from "./AppText";
import { colors } from "@/theme";
export function FormStatus({ message, error = false }: { message: string; error?: boolean }) {
  return message ? <AppText accessibilityLiveRegion="polite" style={{ color:error ? colors.danger : colors.forest, marginVertical:8 }}>{message}</AppText> : null;
}
