import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sdk } from '@/services/sdk';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import AuthLayout from './AuthLayout';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await sdk.session.sendResetLink({ email: email.trim() });
      if (result.ok) setSent(true);
      else setError(result.error?.message || 'We could not send a reset email. Please try again.');
    } catch {
      setError('Password recovery is temporarily unavailable. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sdk.session.initFailed) {
    return <AuthLayout title="Password recovery unavailable" description={sdk.session.configurationError} icon="WifiOff">
      <Link className="text-sm font-medium text-primary hover:underline" to="/login">Back to sign in</Link>
    </AuthLayout>;
  }

  if (sent) return (
    <AuthLayout title="Check your email" description="If an account is registered for that address, a recovery link will arrive shortly." icon="Mail">
      <p className="text-center text-sm text-muted-foreground">If you do not receive an email, check spam and ask your administrator for help.</p>
      <p className="mt-5 text-center text-sm"><Link className="text-primary hover:underline" to="/login">Back to sign in</Link></p>
    </AuthLayout>
  );

  return (
    <AuthLayout title="Forgot password?" description="Enter your email and we'll send you a secure password reset link." icon="KeyRound">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor="recovery-email">Email address</Label>
          <Input id="recovery-email" name="email" type="email" autoComplete="email"
            placeholder="you@gym.com" value={email} maxLength={254} disabled={loading}
            onChange={event => setEmail(event.target.value)} required autoFocus />
        </div>
        {error && <p role="alert" aria-live="polite" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
          {loading ? 'Sending reset link…' : 'Send reset link'}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Remembered your password? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
