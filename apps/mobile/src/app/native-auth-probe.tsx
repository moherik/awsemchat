import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { AuthError, createAuthAPI } from '../features/auth/api';
import { createSessionOwner } from '../features/auth/session-owner';
import { createSessionVault, installationDeviceId } from '../features/auth/session-vault.native';
import { bindAccountEncryption } from '../security/bound-encryption.native';
import { DurableEncryptionError } from '../security/durable-encryption';
import { createLoginFlow } from '../features/auth/login-flow';
import * as Crypto from 'expo-crypto';

export default function NativeAuthProbe() {
  const { phase, run } = useLocalSearchParams<{ phase?: string; run?: string }>();
  const started = useRef(false);
  const [result, setResult] = useState('Native authentication validation');
  useEffect(() => {
    if (!__DEV__ || started.current || !run || !/^[0-9]{8}$/.test(run) || !['start', 'resume', 'bind', 'flow'].includes(phase ?? '')) return;
    started.current = true;
    void (async () => {
      console.info('AWSEM_NATIVE_AUTH_PROBE', JSON.stringify({ status: 'START', synthetic: true, phase }));
      try {
        const origin = 'http://127.0.0.1:8088';
        const api = createAuthAPI(origin, true);
        const deviceId = await installationDeviceId();
        const vault = await createSessionVault(`native-auth-probe.${run}`);
        const owner = createSessionOwner(api, vault, deviceId);
        if (phase === 'flow') {
          const login = createLoginFlow(owner, () => bindAccountEncryption(owner, origin), Crypto.randomUUID);
          await login.restore();
          if (login.getSnapshot().phase !== 'phone') throw new AuthError('FIXTURE_NOT_EMPTY');
          const phone = `+62877${run}`;
          await login.submitPhone(phone);
          if (login.getSnapshot().phase !== 'code') throw new AuthError('CODE_STEP_MISSING');
          await login.verify(await api.developmentCode(phone));
          if (login.getSnapshot().phase !== 'ready' || await vault.read() === null) throw new AuthError('LOGIN_NOT_READY');
          await login.logout();
          if (login.getSnapshot().phase !== 'phone' || await vault.read() !== null) throw new AuthError('LOGOUT_FAILED');
          setResult('Native login flow passed.');
          console.info('AWSEM_NATIVE_AUTH_PROBE', JSON.stringify({ status: 'PASS', synthetic: true, phase, checks: ['PHONE_TO_CODE', 'CODE_TO_NATIVE_CRYPTO', 'PERSISTENCE_BEFORE_READY', 'LOGOUT_TO_PHONE'] }));
          return;
        }
        const key = `auth.probe.${run}`;
        const options = { keychainService: 'awsemchat.auth.probe', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
        if (phase === 'start') {
          if (await vault.read() !== null) throw new AuthError('CHECKPOINT_EXISTS');
          const phone = `+62877${run}`;
          await owner.start(phone, `native-auth:${run}`);
          const response = await fetch(`${origin}/dev/otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
          if (!response.ok) throw new AuthError('MOCK_UNAVAILABLE');
          const body: unknown = await response.json();
          if (!body || typeof body !== 'object' || !('code' in body) || typeof body.code !== 'string' || !/^[0-9]{6}$/.test(body.code)) throw new AuthError('INVALID_RESPONSE');
          await owner.verify(body.code);
          const session = owner.requireSession();
          await SecureStore.setItemAsync(key, JSON.stringify({ deviceId, accountId: session.account.id, generation: session.generation }), options);
          if (await vault.read() === null) throw new AuthError('SESSION_NOT_PERSISTED');
          setResult('Checkpoint saved. Force-stop, then run resume.');
          console.info('AWSEM_NATIVE_AUTH_PROBE', JSON.stringify({ status: 'PASS', synthetic: true, phase, checks: ['NATIVE_HTTP', 'NATIVE_SECURE_WRITE', 'DEVICE_BINDING'] }));
        } else {
          const raw = await SecureStore.getItemAsync(key, options);
          if (!raw) throw new AuthError('CHECKPOINT_MISSING');
          const checkpoint = JSON.parse(raw);
          if (checkpoint.deviceId !== deviceId) throw new AuthError('DEVICE_CHANGED');
          await owner.restore();
          const session = owner.requireSession();
          if (session.account.id !== checkpoint.accountId || session.generation !== checkpoint.generation) throw new AuthError('IDENTITY_CHANGED');
          if (phase === 'bind') {
            const first = await bindAccountEncryption(owner, origin);
            const keys = await first.bundle();
            const reopened = await bindAccountEncryption(owner, origin);
            if (JSON.stringify(await reopened.bundle()) !== JSON.stringify(keys)) throw new AuthError('KEYS_CHANGED');
            await owner.logout();
            try { await first.bundle(); throw new AuthError('STALE_CRYPTO_USABLE'); } catch (error) {
              if (!(error instanceof AuthError) || error.code !== 'SESSION_REVOKED') throw error;
            }
            await SecureStore.deleteItemAsync(key, options);
            setResult('Native account-bound encryption and logout gate passed.');
            console.info('AWSEM_NATIVE_AUTH_PROBE', JSON.stringify({ status: 'PASS', synthetic: true, phase, checks: ['ACCOUNT_CRYPTO', 'STABLE_NATIVE_KEYS', 'STALE_ADAPTER_REJECTED'] }));
            return;
          }
          await owner.logout();
          if (await vault.read() !== null || owner.getSnapshot().status !== 'signed-out') throw new AuthError('LOGOUT_FAILED');
          await SecureStore.deleteItemAsync(key, options);
          setResult('Native restart, revalidation and logout passed.');
          console.info('AWSEM_NATIVE_AUTH_PROBE', JSON.stringify({ status: 'PASS', synthetic: true, phase, checks: ['PROCESS_RESTART', 'NATIVE_SECURE_REOPEN', 'SERVER_REVALIDATION', 'LOGOUT'] }));
        }
      } catch (error) {
        const code = error instanceof AuthError || error instanceof DurableEncryptionError ? error.code : 'PROBE_FAILED';
        setResult(`Native authentication validation failed (${code}).`);
        console.info('AWSEM_NATIVE_AUTH_PROBE', JSON.stringify({ status: 'FAIL', synthetic: true, phase, code }));
      }
    })();
  }, [phase, run]);
  if (!__DEV__) return <Text>Validation unavailable in production</Text>;
  return <View style={{ padding: 24 }}><Text>{result}</Text></View>;
}
