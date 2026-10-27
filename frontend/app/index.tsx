import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { getSession,pendingAccount } from "@/services/authService";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
export default function Index() {
  const [destination,setDestination] = useState<"/(tabs)" | "/welcome" | "/pending" | null>(null);
  useEffect(() => { getSession().then(async s => setDestination(s ? "/(tabs)" : await pendingAccount() ? "/pending" : "/welcome")).catch(() => setDestination("/welcome")); },[]);
  return destination ? <Redirect href={destination} /> : <Screen><AppText>Opening local workspace...</AppText></Screen>;
}
