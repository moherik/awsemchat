import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text } from 'react-native';
import { Page, Copy, Field, usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import { AuthError } from './api';
import { authenticationRuntime } from './runtime';
import type { AuthenticationRuntime } from './runtime';
import type { LoginSnapshot } from './login-flow';

const initial: LoginSnapshot = Object.freeze({ phase: 'phone', busy: false, phone: '' });
const noopSubscribe = () => () => {};
const messages: Record<string, string> = {
  INVALID_INPUT: 'Check your number or enter the six-digit code.', INVALID_CODE: 'That code does not match. Try again.',
  NETWORK: 'Could not connect. Your details are kept so you can retry.', RATE_LIMITED: 'Please wait a minute before requesting another code.',
  EXPIRED: 'That code expired. Request another code.', CONSUMED: 'That code was already used. Request another code.',
  STORAGE: 'Secure storage is unavailable. Unlock your phone and retry.', NATIVE_REQUIRED: 'Sign-in requires the Android development app.',
  CONFIGURATION: 'The sign-in server is not configured for this build.', UNAVAILABLE: 'Sign-in could not finish. Please retry.',
};
export default function AuthenticationScreen() {
  const [runtime, setRuntime] = useState<AuthenticationRuntime | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const c = usePalette();
  const boot = useCallback(() => {
    setBootError(null);
    void authenticationRuntime().then(setRuntime, error => setBootError(error instanceof AuthError ? error.code : 'UNAVAILABLE'));
  }, []);
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(value => { if (active) setRuntime(value); }, error => { if (active) setBootError(error instanceof AuthError ? error.code : 'UNAVAILABLE'); });
    return () => { active = false; };
  }, []);
  const state = useSyncExternalStore(runtime?.flow.subscribe ?? noopSubscribe, runtime?.flow.getSnapshot ?? (() => initial), () => initial);
  const action = (label: string, work: () => Promise<void> | void, primary = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: state.busy }} disabled={state.busy} onPress={() => { Promise.resolve().then(work).catch(error => { const key = error instanceof AuthError ? error.code : 'UNAVAILABLE'; if (key !== 'BUSY') showFeedback(messages[key] ?? messages.UNAVAILABLE); }); }} style={{ minHeight: 54, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: primary ? c.accent : c.bg, opacity: state.busy ? 0.6 : 1 }}><Text style={{ color: primary ? c.accent === '#066DB8' ? '#FFFFFF' : '#172027' : c.text, fontSize: 16, fontWeight: primary ? '600' : '400' }}>{state.busy && primary ? 'Please wait…' : label}</Text></Pressable>;
  const title = state.phase === 'code' ? 'Verify your number' : state.phase === 'ready' ? 'Your account' : 'Your phone number';
  return <Page title={title}>
    {!runtime ? <><Copy>{bootError ? messages[bootError] ?? messages.UNAVAILABLE : 'Opening secure sign-in…'}</Copy>{bootError && action('Retry sign-in', boot, true)}</> : <>
      {state.phase === 'phone' && <><Copy>Your number is used to sign in. Friends connect with your PIN and won’t see your phone number.</Copy><Field label="Phone number with country code" value={phone} onChange={setPhone} keyboardType="phone-pad" maxLength={24} />{action('Continue', () => runtime.flow.submitPhone(phone), true)}</>}
      {state.phase === 'code' && <><Copy>Enter the six-digit code for the number ending {state.phone.slice(-4)}.</Copy><Field label="Verification code" value={code} onChange={setCode} keyboardType="number-pad" maxLength={6} />{action('Verify', () => runtime.flow.verify(code), true)}{action('Resend code', () => runtime.flow.resend())}{__DEV__ && action('Fill development code', async () => { setCode(await runtime.developmentCode(state.phone)); showFeedback('Development code filled in.'); })}{action('Change number', () => { runtime.flow.changeNumber(); setCode(''); setPhone(''); })}</>}
      {state.phase === 'preparing' && <><Copy>{state.busy ? 'Preparing encrypted conversations…' : 'Your number is verified. Encryption setup needs another attempt.'}</Copy>{!state.busy && action('Retry encryption setup', () => runtime.flow.retryPreparation(), true)}</>}
      {(state.phase === 'offline' || state.phase === 'locked') && <><Copy>{state.phase === 'offline' ? 'Reconnect to check your saved session before sending messages.' : 'Secure sign-in is locked. Unlock your phone and retry.'}</Copy>{action('Retry saved session', () => runtime.flow.restore(), true)}</>}
      {state.phase === 'ready' && <><Copy>You’re signed in. Your PIN is {runtime.owner.getSnapshot().account?.pin}.</Copy><Copy muted>Your private-chat and Circle sync is still being connected in this development build.</Copy>{action('Sign out', async () => { await runtime.flow.logout(); setPhone(''); setCode(''); })}</>}
      {__DEV__ && <Copy muted>Development build: no SMS will be sent. You can fill the temporary code on the verification screen.</Copy>}
    </>}
  </Page>;
}
