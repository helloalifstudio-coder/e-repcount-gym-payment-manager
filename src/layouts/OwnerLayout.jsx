import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useOwnerLayoutData } from '@/hooks/useOwnerLayoutData';
import ApperIcon from '@/components/ApperIcon';
import UserMenu from '@/components/UserMenu';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import AlifGrowthFooter from '@/components/AlifGrowthFooter';
import { sdk } from '@/services/sdk';

const primaryLinks = [
  { label: 'Home', to: '/', icon: 'LayoutDashboard' },
  { label: 'Members', to: '/members', icon: 'Users' },
  { label: 'Dues', to: '/dues', icon: 'CalendarClock' },
  { label: 'Payments', to: '/payments', icon: 'Wallet' },
];

const secondaryLinks = [
  { label: 'Plans', to: '/plans', icon: 'Layers' },
];

function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ApperIcon name="Dumbbell" size={21} />
      </div>
      {!compact && (
        <div>
          <p className="font-heading text-lg font-bold tracking-tight">RepCount</p>
          <p className="text-xs text-muted-foreground">Gym owner's desk</p>
        </div>
      )}
    </div>
  );
}

function NavItem({ item, onNavigate }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) => cn(
        'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-(--transition-fast) active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <ApperIcon name={item.icon} size={18} />
      <span>{item.label}</span>
    </NavLink>
  );
}

export default function OwnerLayout() {
  const { navItems = [] } = useOwnerLayoutData();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const extraLinks = navItems.filter(item => item.to && !primaryLinks.some(link => link.to === item.to) && !secondaryLinks.some(link => link.to === item.to));

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20 text-foreground md:pb-0">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 md:px-8">
          <Brand />
          <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
            {[...primaryLinks, ...secondaryLinks].map(item => <NavItem key={item.to} item={item} />)}
            {extraLinks.length > 0 && <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" className="gap-2 text-sm">
                  More <ApperIcon name="ChevronDown" size={15} />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex w-[300px] flex-col">
                <SheetTitle className="font-heading">Workspace</SheetTitle>
                <nav className="flex-1 overflow-y-auto space-y-1 p-4">
                  {extraLinks.map(item => <NavItem key={item.to} item={item} />)}
                </nav>
              </SheetContent>
            </Sheet>}
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden md:block"><UserMenu /></div>
            <div className="md:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" className="gap-2" aria-label="Open menu"><ApperIcon name="Menu" size={19} />Menu</Button>
                </SheetTrigger>
                <SheetContent side="right" className="flex w-[min(88vw,340px)] flex-col">
                  <SheetTitle className="shrink-0 border-b border-border p-4 font-heading">Menu</SheetTitle>
                  <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto space-y-1 p-4">
                    {[...primaryLinks, ...secondaryLinks, ...extraLinks].map(item => <NavItem key={item.to} item={item} onNavigate={() => setMobileMenuOpen(false)} />)}
                  </nav>
                  <div className="shrink-0 border-t border-border p-4"><UserMenu /></div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>
      {sdk.isDemo && (
        <div className="border-b border-primary/25 bg-primary/10 px-4 py-2 text-center text-xs font-semibold text-foreground" role="status">
          DEMO MODE · All records are fictional and changes stay in this browser. No Supabase data is accessed.
        </div>
      )}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 md:px-8 md:py-8">
        <ErrorBoundary><Outlet /></ErrorBoundary>
      </main>
      <AlifGrowthFooter />
      <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/98 px-1 pb-[env(safe-area-inset-bottom)] shadow-md md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1 py-2">
          {[...primaryLinks, { label: 'Plans', to: '/plans', icon: 'Layers' }].map((item, index) => (
            <NavLink key={`${item.to}-${index}`} to={item.to} end={item.to === '/'} className={({ isActive }) => cn('flex min-h-12 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors duration-(--transition-fast) hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>
              <ApperIcon name={item.icon} size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
