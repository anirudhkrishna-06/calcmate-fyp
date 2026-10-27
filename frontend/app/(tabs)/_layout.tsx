import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ColorValue } from "react-native";
import { colors } from "@/theme";

type TabIconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: TabIconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={String(color)} size={size} />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.white,
        tabBarInactiveTintColor: '#BBC7CB',
        tabBarStyle: {
          backgroundColor: colors.charcoal,
          borderTopColor: colors.line,
          minHeight: 58,
          paddingTop: 4
        },
        tabBarLabelStyle: {
          fontWeight: "600",
          fontSize: 11
        }
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon("home-outline") }} />
      <Tabs.Screen name="students" options={{ title: "Classroom", tabBarIcon: tabIcon("people-outline") }} />
      <Tabs.Screen name="schedule" options={{ title: "Planner", tabBarIcon: tabIcon("calendar-outline") }} />
      <Tabs.Screen name="assistant" options={{ title: "Assistant", tabBarIcon: tabIcon("chatbubble-outline") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: tabIcon("settings-outline") }} />
    </Tabs>
  );
}
