import { Tabs } from 'expo-router';
import Head from 'expo-router/head';

export default function TabLayout() {
  return (
    <>
      <Head>
        <title>AD会計</title>
        <link rel="icon" type="image/png" href="/icon.png" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="manifest" href="/manifest.json" />
      </Head>
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
    </>
  );
}