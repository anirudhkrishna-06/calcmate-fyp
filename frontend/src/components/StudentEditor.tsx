import { useState } from "react";
import { View } from "react-native";
import { TextField } from "./TextField";
import { Choices } from "./Choices";
import { Button } from "./Button";
import { FormStatus } from "./FormStatus";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { saveStudent } from "@/services/storageService";
export function StudentEditor({ student, onSaved,defaultGrade=1 }: {defaultGrade?:number; student?: { id:string; name:string; grade:number; rollNumber:string }; onSaved:(id:string)=>void }) {
  const [name,setName] = useState(student?.name ?? ""); const [roll,setRoll] = useState(student?.rollNumber ?? "");
  const [grade,setGrade] = useState(student?.grade ?? defaultGrade); const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  useUnsavedChanges(!busy && (name!==(student?.name??"") || roll!==(student?.rollNumber??"") || grade!==(student?.grade??defaultGrade)));
  async function save() {
    setBusy(true); setError("");
    try { const id = await saveStudent({ name,roll,grade },student?.id); onSaved(id); }
    catch(e) { setError(e instanceof Error ? e.message : "Student could not be saved."); }
    finally { setBusy(false); }
  }
  return <View style={{ gap:12 }}>
    <TextField label="Student name" value={name} onChangeText={setName} maxLength={100} />
    <TextField label="Roll number" value={roll} onChangeText={setRoll} maxLength={12} />
    <Choices values={[1,2,3,4].map(g => ({ value:String(g),label:`Grade ${g}` }))} selected={[String(grade)]} onSelect={g => setGrade(Number(g))} />
    <Button label="Save student" icon="save-outline" disabled={busy||!name.trim()||!roll.trim()} onPress={() => void save()} /><FormStatus message={error} error />
  </View>;
}
