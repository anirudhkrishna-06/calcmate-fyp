import { ReactNode } from "react";
import { Link } from "expo-router";
import { View } from "react-native";
import { accountAvailability,apiBaseUrl } from "@/services/apiClient";
import { useLocalData } from "@/hooks/useLocalData";
import { AppText } from "./AppText";
import { Button } from "./Button";
export function AccountGate({children}:{children:ReactNode}) {
  const {data,error,loading,reload}=useLocalData(accountAvailability);
  if(loading)return <AppText muted>Checking account service...</AppText>;
  if(!data)return <View style={{gap:16}}>
    <AppText variant="subheading">Connect your school account service</AppText>
    <AppText muted>{error || "Teacher accounts require a server and administrator approval."}</AppText>
    <Link href="/connection" asChild><Button label="Set up connection" icon="link-outline" /></Link>
    <Button label="Check again" icon="refresh-outline" variant="quiet" onPress={()=>void reload()} />
    <Link href="/welcome" asChild><Button label="Back to welcome" variant="secondary" /></Link>
  </View>;
  return <>{apiBaseUrl()?.startsWith("http:") ? <AppText variant="small" muted>Login </AppText> : null}{children}</>;
}
