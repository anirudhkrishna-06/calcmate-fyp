import { useCallback,useState } from "react";
import { View } from "react-native";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/Button";
import { FormStatus } from "@/components/FormStatus";
import { apiBaseUrl,checkConnection } from "@/services/apiClient";
import { useFocusEffect } from "expo-router";
import { Card } from "@/components/Card";
import { changeAccountEndpoint,flushRevocations } from "@/services/authService";
import NetInfo from '@react-native-community/netinfo';
export default function Connection() {
  const [address,setAddress]=useState(()=>{try {return apiBaseUrl() ?? "";}catch{return "";}});
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [failed,setFailed]=useState(false);
  const [status,setStatus]=useState('Checking server');const [details,setDetails]=useState('');
  useFocusEffect(useCallback(()=>{
    let current=true;
    setBusy(true);setStatus('Checking server');setDetails('');setMessage("Checking server...");
    checkConnection().then(result=>{if(current){setStatus('Connected');setFailed(false);setMessage(result.accounts?'Teacher accounts available.':result.accountError);setDetails(result.generationMessage??'');}})
      .catch(async error=>{const network=await NetInfo.fetch().catch(()=>null);if(current){setStatus(network?.isConnected===false?'Offline':'Server unavailable');setFailed(true);setMessage(error instanceof Error ? error.message : "Server unavailable.");}})
      .finally(()=>{if(current)setBusy(false);});
    return ()=>{current=false;};
  },[]));
  async function check(save=true) {
    setBusy(true);setStatus('Checking server');setMessage("");setDetails('');
    try {
      if(save)await changeAccountEndpoint(address);const result=await checkConnection();
      setStatus('Connected');setMessage(result.accounts?(save?'Connection saved. Teacher accounts available.':'Teacher accounts available.'):result.accountError);setDetails(result.generationMessage??'');
      setFailed(false);void flushRevocations().catch(()=>{});
    } catch(e) {const network=await NetInfo.fetch().catch(()=>null);setStatus(network?.isConnected===false?'Offline':'Server unavailable');setFailed(true);setMessage(e instanceof Error ? e.message : "Unable to connect.");}
    finally {setBusy(false);}
  }
  return <Screen topInset={false}><View style={{gap:20}}><AppText variant="heading">{status}</AppText><AppText muted>Classroom records remain available offline.</AppText>
    <Card><TextField label="API address" value={address} onChangeText={setAddress} placeholder="http://192.168.1.100:8000" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
    <Button label={busy ? "Checking..." : "Save & check connection"} icon="link-outline" disabled={busy||!address.trim()} onPress={()=>void check()} />
    <FormStatus message={message} error={failed} /></Card>
    {failed?<Button label="Retry connection" variant="secondary" disabled={busy} onPress={()=>void check(false)}/>:null}
    {details?<><AppText variant="subheading">Assistant readiness</AppText><AppText muted>{details}</AppText></>:null}
    <AppText variant="subheading">Physical Android phone</AppText><AppText muted>Use your computer LAN address, for example http://192.168.1.100:8000, on the same Wi-Fi network. Localhost and 10.0.2.2 are emulator addresses.</AppText>
    <AppText variant="subheading">Local development</AppText><AppText muted>Expo preview and the school API are separate servers. Classroom records work offline; new AI answers and first-time account access need the API.</AppText>
    <AppText variant="small" muted>For local HTTP accounts, set CALCMATE_ALLOW_INSECURE_AUTH=true and run python -m src.api --host 0.0.0.0 --port 8000. Use HTTPS for deployed school servers. EXPO_PUBLIC_API_BASE_URL sets the initial endpoint; a saved address takes priority.</AppText>
  </View></Screen>;
}
