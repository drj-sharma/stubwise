import { Redirect } from 'expo-router';
import { useBusinessState } from '@/state/business';

/** Entry point: first run goes to setup, every later launch goes to the workers list. */
export default function Index() {
  const { business } = useBusinessState();
  if (business === undefined) return null;
  return <Redirect href={business ? '/workers' : '/setup'} />;
}
