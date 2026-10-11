import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sdk, supabase } from '@/services/sdk';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import ApperIcon from '@/components/ApperIcon';
import AuthLayout from './AuthLayout';

export default function ResetPassword() {
  const [status, setStatus] = useState('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!supabase) { setStatus('expired'); return; }

    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (params.get('error') || hash.get('error')) {
      setError(params.get('error_description') || hash.get('error_description') || 'This recovery link is invalid or expired.');
      setStatus('expired');
      return;
    }

    // detectSessionInUrl in the Supabase client completes the PKCE flow.
    // getSession waits for initialization when a recovery code is present.
    const subscription = supabase.auth.onAuthStateChange((event) => {
      if (active && event === 'PASSWORD_RECOVERY') setStatus('ready');
    });
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (active) {
        if (!sessionError && data.session) setStatus('ready');
        else setStatus('expired');
      }
    }).catch(() => { if (active) setStatus('expired'); });
    return () => { active = false; subscription.data.subscription.unsubscribe(); };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || status !== 'ready') return;
    setError('');
    if (password.length < 12) { setError('Use a password with at least 12 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setSaving(true);
    try {
      const result = await sdk.session.resetPassword({ newPassword: password });
      if (result.ok) {
        setPassword('');
        setConfirmPassword('');
        setStatus('done');
      } else setError(result.error?.message || 'Password reset failed.');
    } catch {
      setError('Password reset failed. Request a new link and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'checking') return (
    <AuthLayout title="Verifying recovery link" description="Checking your secure password reset session…" icon="LoaderCircle">
      <p role="status" className="text-center text-sm text-muted-foreground">Please wait a moment.</p>
    </AuthLayout>
  );

  if (status === 'expired') return (
    <AuthLayout title="Recovery link expired" description="This link is invalid, expired, or has already been used." icon="AlertCircle">
      {error && <p role="alert" className="mb-4 text-center text-sm text-destructive">{error}</p>}
      <p className="text-center text-sm"><Link className="font-medium text-primary hover:underline" to="/forgot-password">Request a new link</Link></p>
    </AuthLayout>
  );

  if (status === 'done') return (
    <AuthLayout title="Password updated" description="Your password is now changed. Sign in with your new password." icon="CheckCircle">
      <p className="text-center text-sm"><Link className="font-medium text-primary hover:underline" to="/login">Return to sign in</Link></p>
    </AuthLayout>
  );

  return (
    <AuthLayout title="Reset password" description="Choose a new password for your RepCount account." icon="KeyRound">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <div className="relative">
            <Input id="new-password" name="newPassword" type={showPassword ? 'text' : 'password'}
              autoComplete="new-password" minLength={12} maxLength={1024} value={password}
              onChange={event => setPassword(event.target.value)} required disabled={saving} autoFocus
              className="pr-10" />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword} disabled={saving}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground">
              <ApperIcon name={showPassword ? 'EyeOff' : 'Eye'} size={16} />
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input id="confirm-password" name="confirmPassword"
            type={showPassword ? 'text' : 'password'} autoComplete="new-password"
            value={confirmPassword} maxLength={1024} disabled={saving}
            onChange={event => setConfirmPassword(event.target.value)} required />
        </div>
        {error && <p role="alert" aria-live="polite" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={saving || !password || !confirmPassword}>
          {saving ? 'Updating password…' : 'Reset password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
