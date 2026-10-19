import { useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/Workspace";
import { LoadingState } from "@/components/LoadingState";
import { FormStatus } from "@/components/FormStatus";
import { useLocalData } from "@/hooks/useLocalData";
import { listNotifications, markNotificationRead } from "@/services/notificationService";
import { colors } from "@/theme";

export default function NotificationsScreen() {
  const loader = useCallback(() => listNotifications(), []);
  const { data, error, loading, reload } = useLocalData(loader);
  return <Screen topInset={false}>
    <View style={styles.header}><View style={{ flex: 1, gap: 4 }}><AppText variant="title">Teacher notifications</AppText><AppText muted>Changes in classroom learning state that may affect your next plan.</AppText></View><Button label="Back" variant="quiet" onPress={() => router.back()} /></View>
    <FormStatus message={error} error />
    {loading && !data ? <LoadingState label="Reading classroom changes" /> : null}
    {!loading && !error && !data?.length ? <EmptyState title="No new classroom changes" detail="Post-class reviews and learning evidence will appear here when they affect the next plan." /> : null}
    {data?.map(item => <View key={item.id} style={[styles.card, !item.read_at && styles.unread]}><View style={styles.cardHeader}><AppText style={styles.type}>{item.type === "learning_change" ? "NEXT PLAN" : item.type.toUpperCase()}</AppText><AppText variant="small" muted>{new Date(item.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</AppText></View><AppText style={styles.title}>{item.title}</AppText><AppText variant="small" muted>{item.body}</AppText>{!item.read_at ? <Button label="Mark as read" variant="quiet" onPress={() => void markNotificationRead(item.id).then(reload)} style={{ alignSelf: "flex-start" }} /> : null}</View>)}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  card: { gap: 7, padding: 15, borderRadius: 16, borderWidth: 1, borderColor: colors.lineLight, backgroundColor: colors.paper },
  unread: { borderColor: colors.gold, backgroundColor: colors.paperWarm },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  type: { fontSize: 10, letterSpacing: 1, fontWeight: "900", color: colors.primary },
  title: { fontWeight: "800", color: colors.charcoal },
});
