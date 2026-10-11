import { useMemo, useState } from 'react';
import { useFetch } from '@/hooks/useFetch';
import { useAuth } from '@/layouts/RootLayout';
import { sdk } from '@/services/sdk';
import { PROFILES, getProfileMeta } from '@/services/userPermissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';

export const route = {
  path: '/settings',
  layout: 'owner',
  access: "profile === 'Admin_c'",
};

export const nav = {
  label: 'Settings',
  icon: 'Settings',
  order: 90,
  profiles: ['Admin_c'],
};

const roleOptions = Object.entries(PROFILES).map(([value, profile]) => ({
  value,
  label: profile.label,
}));

function errorMessage(error) {
  return error?.message || 'The request failed. Check your Supabase configuration and try again.';
}

function Stat({ icon, label, value, detail }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
      <ApperIcon name={icon} size={38} className="pointer-events-none absolute -right-1 -top-1 text-foreground/[0.06]" />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const canManageTeam = getProfileMeta(user?.profile ?? '').canManageTeam;
  const currentUserId = user?.userId ?? user?.id;
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [roleBusyId, setRoleBusyId] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    profileName: 'Staff_c',
  });

  const {
    data: memberResult,
    loading,
    error,
    run: reloadMembers,
  } = useFetch(async () => sdk.teams.getMembers(0, 100), []);

  const members = memberResult?.data ?? [];
  const total = memberResult?.total ?? members.length;
  const adminCount = useMemo(
    () => members.filter(member => member.profile?.name === 'Admin_c' && member.status === 'active').length,
    [members],
  );

  function changeForm(event) {
    const { name, value } = event.target;
    setForm(current => ({ ...current, [name]: value }));
  }

  async function createUser(event) {
    event.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email address.');
      return;
    }
    if (form.password.length < 12) {
      toast.error('Use a password with at least 12 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    if (!Object.hasOwn(PROFILES, form.profileName)) {
      toast.error('Choose a supported role.');
      return;
    }

    setBusy(true);
    try {
      await sdk.teams.createMember({
        email,
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        profileName: form.profileName,
      });
      toast.success(sdk.isDemo ? 'Demo team member added' : 'Account created', {
        description: sdk.isDemo
          ? 'This is a sample team record only; it cannot sign in and no email was sent.'
          : 'The account is active immediately. No email-verification link is required.',
      });
      setForm({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        confirmPassword: '',
        profileName: 'Staff_c',
      });
      setShowCreate(false);
      await reloadMembers();
    } catch (requestError) {
      toast.error(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member, profileName) {
    if (String(member.id) === String(currentUserId)) {
      toast.error('You cannot change your own role here.');
      return;
    }
    if (!Object.hasOwn(PROFILES, profileName)) {
      toast.error('Choose a supported role.');
      return;
    }
    if (member.profile?.name === profileName) return;
    if (member.profile?.name === 'Admin_c' && profileName !== 'Admin_c' && adminCount <= 1) {
      toast.error('Keep at least one active Admin in the workspace.');
      return;
    }

    setRoleBusyId(member.id);
    try {
      await sdk.teams.updateMemberProfile(member.id, { profile: profileName });
      toast.success('User role updated.');
      await reloadMembers();
    } catch (requestError) {
      toast.error(errorMessage(requestError));
    } finally {
      setRoleBusyId('');
    }
  }

  async function removeUser() {
    if (!pendingDelete) return;
    const member = pendingDelete;
    if (String(member.id) === String(currentUserId)) {
      toast.error('You cannot delete the account you are currently using.');
      return;
    }
    if (member.profile?.name === 'Admin_c' && adminCount <= 1) {
      toast.error('Keep at least one active Admin in the workspace.');
      return;
    }

    setBusy(true);
    try {
      await sdk.teams.deleteMember(member.id);
      toast.success('Account deleted', {
        description: member.email + ' can no longer sign in to RepCount.',
      });
      setPendingDelete(null);
      await reloadMembers();
    } catch (requestError) {
      toast.error(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  if (!canManageTeam) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8 text-center">
        <ApperIcon name="ShieldAlert" size={32} className="mx-auto text-muted-foreground" />
        <h1 className="mt-4 font-heading text-2xl font-bold">Administrator access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only an Admin can create accounts, assign roles or remove users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Workspace administration</p>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight">Settings and users</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {sdk.isDemo
              ? 'Showcase workspace roles and team management using fictional users. Demo team records do not create Supabase Auth accounts.'
              : 'Create active accounts directly, assign roles and revoke access. Accounts created here are confirmed by the server without an email-verification step.'}
          </p>
        </div>
        <Button onClick={() => setShowCreate(value => !value)} className="min-h-11">
          <ApperIcon name={showCreate ? 'X' : 'UserPlus'} size={16} className="mr-2" />
          {showCreate ? 'Close form' : 'Create user'}
        </Button>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
        <ApperIcon name="ShieldCheck" size={20} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold">Admin-controlled access</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {sdk.isDemo
              ? 'Demo users are sample entries only. The showcase has one fixed demo login; created team members cannot sign in.'
              : 'New users sign in with the email and password you set. Share temporary credentials through a private channel. Never store account passwords in this application or GitHub.'}
          </p>
        </div>
      </div>

      {sdk.isDemo && (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Demo data stored in this browser</p>
            <p className="text-xs text-muted-foreground">Reset to the original sample members, plans, fees and payments before your next customer presentation.</p>
          </div>
          <Button variant="outline" type="button" onClick={() => {
            sdk.demo.reset();
            toast.success('Sample data restored.');
            window.location.reload();
          }}>Reset demo data</Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon="Users" label="Workspace users" value={loading ? '—' : total} detail="Accounts assigned to this gym" />
        <Stat icon="ShieldCheck" label="Active Admins" value={loading ? '—' : adminCount} detail="Administrators with workspace access" />
        <Stat icon="LockKeyhole" label="Available roles" value={roleOptions.length} detail="Admin, Manager and Staff" />
      </div>

      {showCreate && (
        <form onSubmit={createUser} className="space-y-5 rounded-xl border border-border bg-card p-4 md:p-6">
          <div>
            <h2 className="font-heading text-xl font-bold">Create a user account</h2>
            <p className="mt-1 text-sm text-muted-foreground">{sdk.isDemo ? 'Create a fictional team member for this browser only; no real Auth account or email is created.' : 'The server creates the Supabase Auth account, confirms it and assigns the role within this workspace.'}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" name="firstName" autoComplete="given-name" value={form.firstName} onChange={changeForm} placeholder="First name" disabled={busy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" name="lastName" autoComplete="family-name" value={form.lastName} onChange={changeForm} placeholder="Last name" disabled={busy} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="email">Email address *</Label>
              <Input id="email" name="email" type="email" autoComplete="off" value={form.email} onChange={changeForm} placeholder="person@gym.com" required disabled={busy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Initial password *</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} value={form.password} onChange={changeForm} required disabled={busy} />
              <p className="text-xs text-muted-foreground">At least 12 characters.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password *</Label>
              <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} value={form.confirmPassword} onChange={changeForm} required disabled={busy} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="profileName">Role *</Label>
              <select id="profileName" name="profileName" value={form.profileName} onChange={changeForm} disabled={busy} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {roleOptions.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Only these configured roles are available. A new custom role requires matching permissions in the app and RLS policies.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</Button>
          </div>
        </form>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col justify-between gap-3 border-b border-border p-4 sm:flex-row sm:items-center md:p-5">
          <div>
            <h2 className="font-heading text-lg font-bold">Workspace accounts</h2>
            <p className="mt-1 text-sm text-muted-foreground">Change roles or delete an account. You cannot remove your own account or the final active Admin.</p>
          </div>
          <Button type="button" variant="outline" onClick={reloadMembers} disabled={loading || busy || Boolean(roleBusyId)}>
            <ApperIcon name="RefreshCw" size={15} className="mr-2" />Refresh
          </Button>
        </div>

        {error ? (
          <div role="alert" className="p-6">
            <p className="font-semibold">Couldn't load workspace users.</p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
            <Button variant="outline" className="mt-3" onClick={reloadMembers}>Try again</Button>
          </div>
        ) : loading && !memberResult ? (
          <div className="space-y-3 p-5" aria-label="Loading users">
            <div className="h-12 animate-pulse rounded-md bg-foreground/5" />
            <div className="h-12 animate-pulse rounded-md bg-foreground/5" />
            <div className="h-12 animate-pulse rounded-md bg-foreground/5" />
          </div>
        ) : members.length === 0 ? (
          <div className="p-10 text-center">
            <ApperIcon name="Users" size={30} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-semibold">No users returned</p>
            <p className="mt-1 text-sm text-muted-foreground">Check the initial Admin setup or create the first additional account.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-semibold" scope="col">User</th>
                  <th className="px-5 py-3 font-semibold" scope="col">Role</th>
                  <th className="px-5 py-3 font-semibold" scope="col">Change role</th>
                  <th className="px-5 py-3 text-right font-semibold" scope="col">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map(member => {
                  const role = member.profile?.name ?? '';
                  const isSelf = String(member.id) === String(currentUserId);
                  const lastAdmin = role === 'Admin_c' && adminCount <= 1;
                  return (
                    <tr key={member.id} className="hover:bg-muted/20">
                      <td className="px-5 py-4">
                        <p className="font-semibold">{member.name || 'Unnamed user'} {isSelf && <span className="ml-1 text-xs font-medium text-primary">(You)</span>}</p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">{member.email || 'Email unavailable'}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold">
                          {PROFILES[role]?.label ?? 'Unassigned'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <label className="sr-only" htmlFor={'role-' + member.id}>Change role for {member.name || member.email}</label>
                        <select id={'role-' + member.id} value={role} disabled={isSelf || lastAdmin || busy || Boolean(roleBusyId)} onChange={event => changeRole(member, event.target.value)} className="h-10 min-w-36 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60">
                          {roleOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        {isSelf && <p className="mt-1 text-xs text-muted-foreground">Your own role is locked.</p>}
                        {lastAdmin && !isSelf && <p className="mt-1 text-xs text-muted-foreground">Final Admin protected.</p>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Button type="button" size="sm" variant="outline" disabled={isSelf || lastAdmin || busy || Boolean(roleBusyId)} onClick={() => setPendingDelete(member)}>
                          <ApperIcon name="UserRoundX" size={15} className="mr-2" />Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={open => !open && !busy && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this account?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.email} will lose RepCount access and their Supabase Auth account will be deleted. Gym business records are retained; audit references become unassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={event => { event.preventDefault(); removeUser(); }}>
              {busy ? 'Deleting…' : 'Delete account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
