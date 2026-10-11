import { Link,router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { FormStatus } from "@/components/FormStatus";
import { colors } from "@/theme";
import { exploreDemo,pendingAccount } from "@/services/authService";
import { useLocalData } from "@/hooks/useLocalData";
export default function Welcome() {
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const {data:pending}=useLocalData(pendingAccount);
  async function demo() {setBusy(true);try {await exploreDemo();router.replace("/(tabs)");} catch(e) {setError(e instanceof Error ? e.message : "Could not open demo.");} finally {setBusy(false);}}
  return <Screen><View style={{flex:1,justifyContent:"center",gap:16,paddingVertical:16}}>
    <Ionicons name="school-outline" size={28} color={colors.forest} />
    <AppText variant="title">Calcmate</AppText><AppText variant="subheading">Maths for your classroom</AppText>
    <View style={{gap:12,marginTop:8}}>
      <Link href="/signup" asChild><Button label="Create teacher account" icon="person-add-outline" /></Link>
      <Link href="/login" asChild><Button label="Log in" icon="log-in-outline" variant="secondary" /></Link>
      {pending ? <Link href="/pending" asChild><Button label="View account approval status" variant="secondary" /></Link> : null}
      <Button label={busy ? "Opening demo..." : "Explore demo"} icon="play-outline" variant="quiet" disabled={busy} onPress={()=>void demo()} />
    </View>
    <AppText variant="small" muted>Demo uses fictional students and a separate workspace.</AppText>
    <FormStatus message={error} error />
    <Link href="/connection" asChild><Button label="Server connection" variant="secondary" /></Link>
  </View></Screen>;
}
