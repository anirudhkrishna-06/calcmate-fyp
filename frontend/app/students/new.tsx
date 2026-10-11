import { router,useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/AppText";
import { useGrade } from "@/hooks/useGrade";
import { StudentEditor } from "@/components/StudentEditor";
export default function NewStudentScreen() {
  const params=useLocalSearchParams<{grade?:string}>();const {grade}=useGrade(Number(params.grade));
  return <Screen topInset={false}><AppText variant="title" style={{ marginBottom:16 }}>Add student</AppText>
    <StudentEditor key={grade} defaultGrade={grade} onSaved={id => router.replace(`/students/${id}`)} />
  </Screen>;
}
