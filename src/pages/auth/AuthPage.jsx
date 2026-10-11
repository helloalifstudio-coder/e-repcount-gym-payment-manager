import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { sdk } from '@/services/sdk';
import { setUser } from '@/store/userSlice';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import ApperIcon from '@/components/ApperIcon';
import AuthLayout from './AuthLayout';

export default function AuthPage() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const result = await sdk.session.login({ email: email.trim().toLowerCase(), password });
      if (!result.ok) {
        setError(result.error?.message || 'Sign-in failed. Check your credentials and try again.');
        return;
      }
      dispatch(setUser(result.value));
      navigate('/', { replace: true });
    } catch {
      setError('We could not sign you in right now. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sdk.session.initFailed) {
    return (
      <AuthLayout title="Sign-in is temporarily unavailable" description="RepCount could not initialize its secure connection.">
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground" role="alert">
          {sdk.session.configurationError || 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Vercel, then redeploy. Never add a service-role key to the frontend.'}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Welcome back" description="Sign in to manage members, membership plans and collections." icon="Dumbbell">
      {sdk.isDemo && (
        <div className="mb-5 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm" role="note">
          <p className="font-semibold">Customer demo · Sample records only</p>
          <p className="mt-1 text-muted-foreground">
            Email: <code className="font-mono">admin@gmail.com</code> · Password: <code className="font-mono">admin@123</code>
          </p>
          <button type="button" className="mt-2 font-semibold text-primary underline underline-offset-2"
            onClick={() => { setEmail('admin@gmail.com'); setPassword('admin@123'); }}>
            Fill demo credentials
          </button>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            maxLength={254}
            disabled={loading}
            placeholder="you@gym.com"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            {!sdk.isDemo && <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link>}
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              maxLength={1024}
              disabled={loading}
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(value => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              disabled={loading}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            >
              <ApperIcon name={showPassword ? 'EyeOff' : 'Eye'} size={16} />
            </button>
          </div>
        </div>
        {error && <p role="alert" aria-live="polite" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={loading || !email.trim() || !password} className="mt-1 w-full">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-center text-xs leading-5 text-muted-foreground">
          {sdk.isDemo ? 'This is an isolated product walkthrough. Changes are stored in this browser only.' : "Need access? Ask your gym's administrator to create your account."}
        </p>
      </form>
    </AuthLayout>
  );
}
