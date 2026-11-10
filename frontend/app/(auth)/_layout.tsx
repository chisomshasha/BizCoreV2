import { Stack } from 'expo-router';
import { Colors } from '../../src/components/ThemedComponents';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    />
  );
}
