import { useState } from "react";
import { Link,router } from "expo-router";
import { View } from "react-native";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { FormStatus } from "@/components/FormStatus";
import { AccountGate } from "@/components/AccountGate";
import { ApiError } from "@/services/apiClient";
import { signIn } from "@/services/authService";
export default function LoginScreen() {
  const [email,setEmail]=useState("");const [password,setPassword]=useState("");
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  async function login() {setBusy(true);setError("");try {await signIn(email,password);router.replace("/(tabs)");}
    catch(e) {if(e instanceof ApiError && e.code==="pending-approval") {router.replace("/pending");return;}setError(e instanceof Error ? e.message : "Unable to log in.");} finally {setBusy(false);setPassword("");}}
  return <Screen><View style={{gap:12,paddingVertical:16}}>
    <AppText variant="title">Welcome back</AppText>
    <AccountGate><TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" maxLength={128} />
      <Button label={busy ? "Logging in..." : "Log in"} icon="log-in-outline" disabled={busy||!email.trim()||!password} onPress={()=>void login()} />
      <FormStatus message={error} error />
      <Link href="/signup" asChild><Button label="Create a teacher account" variant="secondary" /></Link>
      <Link href="/welcome" asChild><Button label="Back to welcome" variant="secondary" /></Link>
    </AccountGate>
  </View></Screen>;
}
