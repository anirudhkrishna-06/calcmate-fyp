import { useState } from "react";
import { Link,router } from "expo-router";
import { View } from "react-native";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { Choices } from "@/components/Choices";
import { FormStatus } from "@/components/FormStatus";
import { Section } from "@/components/Workspace";
import { AccountGate } from "@/components/AccountGate";
import { signUp } from "@/services/authService";
export default function SignupScreen() {
  const [name,setName]=useState("");const [school,setSchool]=useState("");const [experience,setExperience]=useState("0");
  const [grades,setGrades]=useState<string[]>(["1"]);const [email,setEmail]=useState("");const [password,setPassword]=useState("");const [confirmation,setConfirmation]=useState("");
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  async function submit() {
    setError("");if(password!==confirmation) {setError("Passwords do not match.");return;}
    if(!name.trim()||!school.trim()||!grades.length||!experience.trim()) {setError("Complete your teacher details and select a grade.");return;}
    if(!Number.isInteger(Number(experience))||Number(experience)<0||Number(experience)>60) {setError("Enter experience as a whole number from 0 to 60.");return;}
    setBusy(true);
    try {await signUp(email,password,{name:name.trim(),schoolName:school.trim(),experience:Number(experience),grades:grades.map(Number)});router.replace("/pending");}
    catch(e) {setError(e instanceof Error ? e.message : "Unable to submit account.");}
    finally {setBusy(false);setPassword("");setConfirmation("");}
  }
  return <Screen><View style={{gap:12,paddingVertical:16}}>
    <AppText variant="title">Create teacher account</AppText><AppText muted>Your administrator approves access before your first login.</AppText>
    <AccountGate>
      <Section title="Teacher details"><TextField label="Teacher name" value={name} onChangeText={setName} maxLength={100} autoComplete="name" />
      <TextField label="School" value={school} onChangeText={setSchool} maxLength={150} />
      <TextField label="Experience in years" value={experience} onChangeText={setExperience} keyboardType="number-pad" />
      </Section><Section title="Teaching grades">
      <Choices values={[1,2,3,4,5].map(g=>({value:String(g),label:`Grade ${g}`}))} selected={grades} onSelect={g=>setGrades(old=>old.includes(g)?old.filter(v=>v!==g):[...old,g])} />
      <AppText muted>Maths</AppText>
      </Section><Section title="Account details"><TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <TextField label="Password (8+ characters, letters and numbers)" value={password} onChangeText={setPassword} secureTextEntry maxLength={128} autoComplete="new-password" />
      <TextField label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry maxLength={128} />
      </Section><Button label={busy ? "Submitting..." : "Request approval"} icon="person-add-outline" disabled={busy} onPress={()=>void submit()} />
      <FormStatus message={error} error />
      <Link href="/login" asChild><Button label="Already registered? Log in" variant="secondary" /></Link>
      <Link href="/welcome" asChild><Button label="Back to welcome" variant="secondary" /></Link>
    </AccountGate>
  </View></Screen>;
}
