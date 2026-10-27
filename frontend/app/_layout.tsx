import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppState } from "react-native";
import { colors } from "@/theme";
import { getSession,refreshSession,subscribeSession,AuthSession } from "@/services/authService";
import { initializeGrade } from "@/services/gradePreference";
import { loadApiConfiguration } from "@/services/apiClient";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
export default function RootLayout() {
  const [session,setSession] = useState<AuthSession | null>(null);
  const [loading,setLoading] = useState(true);
  useEffect(() => {
    const refresh = () => { Promise.all([loadApiConfiguration(),initializeGrade()]).then(getSession).then(s=>{setSession(s);void refreshSession().catch(()=>{});}).catch(() => setSession(null)).finally(() => setLoading(false)); };
    refresh();
    const unsubscribe = subscribeSession(setSession);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    return () => { unsubscribe(); subscription.remove(); };
  },[]);
  useEffect(() => {
    if (session?.mode !== "real" || !session.validUntil) return;
    const timeout = setTimeout(() => { getSession().then(setSession).catch(() => setSession(null)); },Math.min(2147483647,Math.max(0,Date.parse(session.validUntil)-Date.now())));
    return () => clearTimeout(timeout);
  },[session]);
  if (loading) return <Screen><AppText>Opening Calcmate...</AppText></Screen>;
  return <>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerStyle:{ backgroundColor:colors.ivory },headerShadowVisible:false,headerTintColor:colors.charcoal,contentStyle:{ backgroundColor:colors.ivory } }}>
      <Stack.Screen name="index" options={{ headerShown:false }} />
      <Stack.Screen name="connection" options={{title:"Server connection"}} />
      <Stack.Protected guard={!session}><Stack.Screen name="(auth)" options={{ headerShown:false }} /></Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" options={{ headerShown:false }} />
        <Stack.Screen name="profile" options={{ title:"Teacher Profile" }} />
        <Stack.Screen name="chatbot" options={{ title:"AI Assistant",headerShown:false }} />
        <Stack.Screen name="students/new" options={{ title:"Add Student" }} />
        <Stack.Screen name="attendance" options={{title:"Class attendance"}} />
        <Stack.Screen name="students/[id]" options={{ title:"Student Details" }} />
        <Stack.Screen name="schedule/generated" options={{ title:"Revision Plan" }} />
        <Stack.Screen name="schedule/[id]" options={{ title:"Saved Lesson Plan" }} />
        <Stack.Screen name="general-schedule/new" options={{ title:"Create general schedule" }} />
        <Stack.Screen name="general-schedule/[id]" options={{ title:"General schedule" }} />
        <Stack.Screen name="active-session" options={{ title:"Active Class Session",headerShown:false }} />
        <Stack.Screen name="notifications" options={{ title:"Teacher notifications",headerShown:false }} />
        <Stack.Screen name="post-class-review" options={{ title:"Post-Class Review",headerShown:false }} />
        <Stack.Screen name="curriculum" options={{ title:"Knowledge Graph" }} />
        <Stack.Screen name="weekly-schedule/new" options={{ title:"Weekly Classroom Plan" }} />
        <Stack.Screen name="weekly-schedule/[id]" options={{ title:"Weekly Schedule",headerShown:false }} />
      </Stack.Protected>
    </Stack>
  </>;
}
