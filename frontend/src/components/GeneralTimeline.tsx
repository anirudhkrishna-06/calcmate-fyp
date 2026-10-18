import { useState,useCallback } from 'react';
import { router,useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { TextField } from './TextField';
import { Choices } from './Choices';
import { FormStatus } from './FormStatus';
import { Screen } from './Screen';
import { colors } from '@/theme';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { saveGeneralBlocks,isScheduleOutdated } from '@/services/generalScheduleService';
import type { GeneralSchedule,RotationBlock } from '@/types/generalSchedule';

export function GeneralTimeline({schedule}:{schedule:GeneralSchedule}){
  const [blocks,setBlocks]=useState(schedule.blocks);const [baseline,setBaseline]=useState(JSON.stringify(schedule.blocks));
  const [outdated,setOutdated]=useState(false);
  useFocusEffect(useCallback(()=>{let active=true;void isScheduleOutdated(schedule).then(value=>{if(active)setOutdated(value);}).catch(()=>{});return()=>{active=false;};},[schedule]));
  const [editing,setEditing]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [failed,setFailed]=useState(false);
  const dirty=JSON.stringify(blocks)!==baseline;useUnsavedChanges(dirty&&!busy);
  const update=(id:string,patch:Partial<RotationBlock>)=>setBlocks(previous=>previous.map(b=>b.id===id?{...b,...patch}:b));
  async function save(){setBusy(true);setMessage('');try{const next=await saveGeneralBlocks(schedule.id,blocks);setBlocks(next.blocks);setBaseline(JSON.stringify(next.blocks));setEditing(null);setFailed(false);setMessage('Saved on device');}catch(e){setFailed(true);setMessage(e instanceof Error?e.message:'Could not save schedule.');}finally{setBusy(false);}}
  const total=blocks.reduce((sum,b)=>sum+b.durationMinutes,0);
  return <Screen topInset={false} footer={<View style={{flexDirection:'row',gap:8}}><Button label="Start active class" icon="play-circle-outline" variant="secondary" onPress={()=>router.push({pathname:'/active-session',params:{scheduleId:schedule.id}})} style={{flex:1}}/><Button label={busy?'Saving...':'Save changes'} disabled={busy||!dirty} onPress={()=>void save()} style={{flex:1}}/></View>}>
    <AppText variant="title">Classroom rotation</AppText><AppText muted>{schedule.selection.date} · Grades {schedule.selection.grades.join(', ')} · {schedule.selection.availableMinutes} min</AppText>
    <AppText variant="small" muted>{schedule.engine==='observed-evidence'?'Classroom evidence planner. Generate a new plan after recording marks.':'Offline local heuristic. Based on records saved on this device.'}</AppText>
    {outdated?<AppText style={{color:colors.attention}}>Classroom evidence has changed. Generate a new plan to use the latest records; your saved activities are retained.</AppText>:null}
    {schedule.warnings.map(w=><View key={w} style={{borderLeftWidth:3,borderColor:colors.attention,paddingLeft:12}}><AppText style={{color:colors.attention}}>{w}</AppText></View>)}
    <FormStatus message={message} error={failed}/>{dirty?<AppText variant="small" muted>Unsaved · {Number.isFinite(total)?total:'—'}/{schedule.selection.availableMinutes} min</AppText>:null}
    {blocks.map((block,index)=>{
      const start=blocks.slice(0,index).reduce((sum,b)=>sum+b.durationMinutes,0);const end=start+block.durationMinutes;const edit=editing===block.id;
      return <View key={block.id} style={{borderTopWidth:1,borderColor:colors.line,paddingTop:14,gap:10,opacity:block.status==='postponed'?0.75:1}}>
        <View style={{flexDirection:'row',gap:12,alignItems:'flex-start'}}><View style={{width:72,borderLeftWidth:3,borderColor:block.teacherGrade?colors.forest:colors.line,paddingLeft:8}}><AppText variant="subheading">{Number.isFinite(start)?start:'—'}–{Number.isFinite(end)?end:'—'}</AppText><AppText variant="small" muted>{block.durationMinutes||'—'} min</AppText></View>
          <View style={{flex:1,minWidth:0}}><AppText variant="subheading">{block.teacherGrade?`Teacher → Grade ${block.teacherGrade}`:block.kind==='transition'?'Transition':'All grades'}</AppText><AppText>{block.teacherActivity}</AppText></View></View>
        <AppText variant="small" muted>{block.reason}</AppText>
        {block.activities.map(a=><View key={a.grade} style={{paddingLeft:12,borderLeftWidth:1,borderColor:a.grade===block.teacherGrade?colors.forest:colors.line,gap:3}}>
          <AppText variant="small" style={{fontWeight:'700',color:a.grade===block.teacherGrade?colors.forest:colors.charcoal}}>Grade {a.grade} · {a.concept}{a.grade===block.teacherGrade?' · Guided':''}</AppText>
          {edit?<><TextField label={`Grade ${a.grade} activity`} value={a.activity} multiline editable={!busy} onChangeText={value=>update(block.id,{activities:block.activities.map(v=>v.grade===a.grade?{...v,activity:value}:v)})}/><TextField label={`Grade ${a.grade} objective`} value={a.objective} multiline editable={!busy} onChangeText={value=>update(block.id,{activities:block.activities.map(v=>v.grade===a.grade?{...v,objective:value}:v)})}/></>:<><AppText>{a.activity}</AppText><AppText variant="small" muted>{a.objective}</AppText></>}
          {a.conceptId ? <Button label="Open concept graph" variant="quiet" onPress={()=>router.push({pathname:'/curriculum',params:{grade:String(a.grade),conceptId:a.conceptId,origin:'general-schedule'}})} /> : null}
        </View>)}
        {edit?<><TextField label="Teacher activity" value={block.teacherActivity} multiline editable={!busy} onChangeText={v=>update(block.id,{teacherActivity:v})}/><TextField label="Duration (minutes)" value={Number.isFinite(block.durationMinutes)?String(block.durationMinutes):''} keyboardType="number-pad" editable={!busy} onChangeText={v=>update(block.id,{durationMinutes:v.trim()?Number(v):0})}/><AppText variant="small" muted>Keep the full schedule at {schedule.selection.availableMinutes} minutes.</AppText></>:null}
        <Choices values={['planned','completed','postponed'].map(v=>({value:v,label:v[0].toUpperCase()+v.slice(1),disabled:busy}))} selected={[block.status]} onSelect={v=>update(block.id,{status:v as RotationBlock['status']})}/>
        <Button label={edit?'Finish editing':'Edit block'} variant="quiet" disabled={busy} accessibilityLabel={`${edit?'Finish editing':'Edit'} block ${index+1}`} onPress={()=>setEditing(edit?null:block.id)}/>
      </View>;
    })}
  </Screen>;
}
