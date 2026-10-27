import { useCallback } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useLocalData } from '@/hooks/useLocalData';
import { loadGeneralSchedule } from '@/services/generalScheduleService';
import { GeneralTimeline } from '@/components/GeneralTimeline';
import { Screen } from '@/components/Screen';
import { AppText } from '@/components/AppText';
import { FormStatus } from '@/components/FormStatus';
import { Button } from '@/components/Button';
export default function GeneralScheduleDetail(){
  const {id}=useLocalSearchParams<{id:string}>();
  const loader=useCallback(()=>loadGeneralSchedule(id),[id]);const {data,error,reload}=useLocalData(loader);
  if(data)return <GeneralTimeline key={data.id} schedule={data}/>;
  return <Screen topInset={false}><AppText>Opening schedule...</AppText><FormStatus message={error} error/>{error?<Button label="Retry" onPress={()=>void reload()}/>:null}</Screen>;
}
