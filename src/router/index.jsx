import { createBrowserRouter } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import RootLayout from '@/layouts/RootLayout';
import OwnerLayout from '@/layouts/OwnerLayout';
import PublicLayout from '@/layouts/PublicLayout';
import AppLoader from '@/components/AppLoader';
import PageSkeleton from '@/components/PageSkeleton';

// Route chunk fallbacks: app pages show a neutral page skeleton in the content area; auth pages
// keep the boot loader so first open reads as one continuous state.
const PageLoader = () => <PageSkeleton />;
const AuthLoader = () => <AppLoader />;

const wrap = (Component) => (
  <Suspense fallback={<PageLoader />}><Component /></Suspense>
);
const authWrap = (Component) => (
  <Suspense fallback={<AuthLoader />}><Component /></Suspense>
);

// Auto-discover: eager modules for route metadata + lazy loaders for code-splitting
const pageMods = import.meta.glob('/src/pages/**/*.jsx', { eager: true });
const pageLoaders = import.meta.glob('/src/pages/**/*.jsx');
const NotFoundPage = lazy(() => import('@/pages/NotFound'));

// Warm every page chunk once the browser is idle, so the first click on a nav item renders from
// cache instead of waiting on a network fetch (the "URL changed but the page came later" first-open lag).
if (typeof window !== 'undefined') {
  const warm = () => { for (const load of Object.values(pageLoaders)) { try { load().catch(() => {}); } catch { /* ignore */ } } };
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 4000 });
  else setTimeout(warm, 1500);
}

const discoveredRoutes = Object.entries(pageMods)
  .filter(([, mod]) => mod.route)
  .map(([filePath, mod]) => ({
    ...mod.route,
    _component: lazy(pageLoaders[filePath]),
  }));

function buildDiscoveredRoute(r) {
  const isIndex = r.path === '/';
  const config = {
    element: wrap(r._component),
    // An owner-layout page that forgot `access` is private, never public: the shell is for signed-in users.
    handle: { access: r.access ?? (r.layout === 'owner' ? 'authenticated' : 'public') },
  };
  if (isIndex) config.index = true;
  else config.path = r.path.replace(/^\//, '');
  return config;
}

// Keep one public sign-in screen. New accounts are provisioned by an active Admin.
const AuthPage = lazy(() => import('@/pages/auth/AuthPage'));
const AuthForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword'));
const AuthResetPassword = lazy(() => import('@/pages/auth/ResetPassword'));
const AuthAccessDenied = lazy(() => import('@/pages/auth/AccessDenied'));

function buildAuthRoutes() {
  const loginEl = (
    <Suspense fallback={<AuthLoader />}><AuthPage /></Suspense>
  );
  return [
    { path: 'login', element: loginEl, handle: { access: 'public' } },
    { path: 'forgot-password', element: authWrap(AuthForgotPassword), handle: { access: 'public' } },
    { path: 'reset-password', element: authWrap(AuthResetPassword), handle: { access: 'public' } },
    { path: 'access-denied', element: authWrap(AuthAccessDenied), handle: { access: 'public' } },
  ];
}

const ownerRoutes = discoveredRoutes.filter((r) => r.layout === 'owner').map(buildDiscoveredRoute);
const publicRoutes = [
  ...discoveredRoutes.filter((r) => r.layout === 'public').map(buildDiscoveredRoute),
  ...buildAuthRoutes(),
];

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        element: <OwnerLayout />,
        children: [...ownerRoutes],
      },
      {
        element: <PublicLayout />,
        children: [...publicRoutes],
      },
      { path: '*', element: wrap(NotFoundPage) },
    ],
  },
]);
