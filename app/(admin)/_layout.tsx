import { Stack, Redirect, useSegments, usePathname } from 'expo-router';
import { useAuthStore } from '../../src/store/useAuthStore';
import React from 'react';

export default function AdminLayout() {
  const user = useAuthStore(s => s.user);
  const pathname = usePathname();

  // 🛡️ Unauthorized Path Protection: Force redirect if non-admin attempts to enter
  // EXCEPTION: Ustazs are allowed to view the Student Detail dossier page (any /students/<id> path)
  // EXCEPTION: Ustazs are also allowed onto the Nuraniyah daily class ratings screen — they need
  // it to review/rate their own level day-to-day, same reasoning as the attendance tab.
  // EXCEPTION: Committee is a read-only observer role (see isObserver in students.tsx, and the
  // 'admin'/'finance'/'committee' checks in attendance.tsx) — they need to view the Student
  // Detail dossier page too, same as finance. The page itself already hides all edit affordances
  // (pencil icon, Danger Zone) behind `role === 'admin'`, so this only grants viewing, not editing.
  const isStudentDetail = pathname.includes('/students/') && !pathname.endsWith('/add');
  const isNuraniyahDaily = pathname.includes('/nuraniyah-daily');
  const isUstaz = user?.role === 'ustaz';
  const isFinance = user?.role === 'finance';
  const isCommittee = user?.role === 'committee';
  
  if (!user || (user.role !== 'admin' && !(isUstaz && (isStudentDetail || isNuraniyahDaily)) && !(isFinance && isStudentDetail) && !(isCommittee && isStudentDetail))) {
    return <Redirect href="/(tabs)/dashboard" />;
  }


  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="students/add" />
      <Stack.Screen name="students/[id]" />
      <Stack.Screen name="teachers" />
      <Stack.Screen name="manage-subjects" />
      <Stack.Screen name="nuraniyah-daily" />
    </Stack>
  );
}
