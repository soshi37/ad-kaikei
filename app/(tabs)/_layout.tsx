import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'クイック入力',
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: '履歴・本体',
        }}
      />
    </Tabs>
  );
}