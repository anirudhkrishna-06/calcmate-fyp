import { useState } from 'react';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { DateField } from '@/components/DateField';
import { Choices } from '@/components/Choices';
import { FormStatus } from '@/components/FormStatus';
import { Section } from '@/components/Workspace';
import { useLocalData } from '@/hooks/useLocalData';
import { loadTeacher } from '@/services/storageService';
import { today } from '@/services/database';
import { createGeneralSchedule } from '@/services/generalScheduleService';
import type { Grade } from '@/types/domain';
import type { GeneralSelection } from '@/types/generalSchedule';

export default function NewGeneralSchedule(){
  const {data:teacher,error:profileError,loading,reload}=useLocalData(loadTeacher);
  const [selected,setSelected]=useState<Grade[]|null>(null);
  const grades=selected??teacher?.grades??[];
  const [minutes,setMinutes]=useState('90');const [date,setDate]=useState(today());
  const [priority,setPriority]=useState<GeneralSelection['priority']>('balanced');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function generate(){setBusy(true);setError('');try{const saved=await createGeneralSchedule({date,grades,priority,availableMinutes:Number(minutes)});router.replace(`/general-schedule/${saved.id}`);}catch(e){setError(e instanceof Error?e.message:'Could not create schedule.');}finally{setBusy(false);}}
  return <Screen topInset={false} footer={<Button label={busy?'Creating schedule...':'Create schedule'} disabled={busy||loading||!!profileError} onPress={()=>void generate()}/>}>
    <AppText variant="title">General schedule</AppText><AppText muted>One teacher, multiple grades</AppText>
    <FormStatus message={error||profileError} error/>{profileError?<Button label="Retry" variant="quiet" onPress={()=>void reload()}/>:null}
    <Section title="Classroom time"><Choices values={[60,90,120,180].map(n=>({value:String(n),label:`${n} min`,disabled:busy}))} selected={[minutes]} onSelect={setMinutes}/>
      <TextField label="Total minutes" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" maxLength={3} editable={!busy}/>
      <DateField label="Planning date" value={date} onChange={setDate} disabled={busy}/></Section>
    <Section title="Grades"><Choices multiple values={[1,2,3,4,5].map(g=>({value:String(g),label:`Grade ${g}`,disabled:busy||loading}))} selected={grades.map(String)} onSelect={value=>{const g=Number(value) as Grade;setSelected(grades.includes(g)?grades.filter(v=>v!==g):[...grades,g]);}}/></Section>
    <Section title="Priority"><Choices values={[{value:'balanced',label:'Balanced',disabled:busy},{value:'learning-needs',label:'Learning needs',disabled:busy}]} selected={[priority]} onSelect={v=>setPriority(v as GeneralSelection['priority'])}/>
      <AppText variant="small" muted>{priority==='balanced'?'Give every grade time, with extra support for gaps.':'Give more time to revision and prerequisite gaps.'}</AppText></Section>
  </Screen>;
}
