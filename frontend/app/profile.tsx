import { useState } from "react";
import { View } from "react-native";
import { Section,LocalStatus } from "@/components/Workspace";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { Choices } from "@/components/Choices";
import { FormStatus } from "@/components/FormStatus";
import { loadTeacher,saveTeacher } from "@/services/storageService";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useLocalData } from "@/hooks/useLocalData";
import { Grade,Teacher } from "@/types/domain";
export default function TeacherProfileScreen() {
  const { data,error } = useLocalData(loadTeacher);
  return <Screen topInset={false}><AppText variant="title" style={{ marginBottom:16 }}>Teacher profile</AppText>
    <FormStatus message={error} error />
    {data ? <ProfileForm key={JSON.stringify(data)} teacher={data} /> : <AppText>Loading profile...</AppText>}
  </Screen>;
}
function ProfileForm({ teacher }: { teacher:Teacher }) {
  const [name,setName] = useState(teacher.name); const [school,setSchool] = useState(teacher.schoolName);
  const [experience,setExperience] = useState(String(teacher.experience ?? 0));
  const [grades,setGrades] = useState<Grade[]>(teacher.grades); const [status,setStatus] = useState(""); const [failed,setFailed] = useState(false); const [busy,setBusy] = useState(false);
  const snapshot=JSON.stringify({name,school,experience,grades});const [saved,setSaved]=useState(snapshot);
  useUnsavedChanges(!busy && saved!==snapshot);
  async function save() {
    setBusy(true);
    try { await saveTeacher({ ...teacher,name,schoolName:school,experience:experience.trim() ? Number(experience) : NaN,grades }); setSaved(snapshot);setStatus("Profile saved on this device."); setFailed(false); }
    catch(e) { setStatus(e instanceof Error ? e.message : "Unable to save profile."); setFailed(true); }
    finally { setBusy(false); }
  }
  return <View style={{ gap:12 }}><LocalStatus text="Profile changes are saved on this device"/><Section title="Teacher details">
    <TextField label="Teacher name" value={name} onChangeText={setName} maxLength={100} />
    <TextField label="School" value={school} onChangeText={setSchool} maxLength={150} />
    <TextField label="Experience (years)" value={experience} onChangeText={setExperience} keyboardType="number-pad" />
    </Section><Section title="Teaching grades">
    <Choices values={[1,2,3,4].map(g => ({ value:String(g),label:`Grade ${g}` }))} selected={grades.map(String)}
      onSelect={value => { const g = Number(value) as Grade; setGrades(old => old.includes(g) ? old.filter(x => x!==g) : [...old,g].sort()); }} />
    </Section><Section title="Subjects">
    <Choices values={[{value:"Math",label:"Maths"},...["EVS","English","Hindi"].map(s => ({value:s,label:s,disabled:true}))]} selected={["Math"]} onSelect={() => {}} />
    </Section><Button label="Save profile" icon="save-outline" disabled={busy} onPress={() => void save()} />
    <FormStatus message={status} error={failed} />
  </View>;
}
