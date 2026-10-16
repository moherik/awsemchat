import { useLocalSearchParams } from 'expo-router';
import { ProductionChat } from '@/features/messages/screen';
export default function ChatRoute() {
  const { peer, circle } = useLocalSearchParams<{ peer?: string; circle?: string }>();
  return <ProductionChat peer={typeof peer === 'string' ? peer : peer === undefined ? undefined : ''} circle={typeof circle === 'string' ? circle : circle === undefined ? undefined : ''} />;
}
