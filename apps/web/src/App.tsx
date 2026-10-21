import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { SessionProvider, useSessionState } from './data/session';
import { Buy } from './screens/Buy';
import { ChooseBusiness } from './screens/ChooseBusiness';
import { ContactDetail, ContactEdit, Contacts } from './screens/Contacts';
import { DocumentDetail, History } from './screens/History';
import { Home } from './screens/Home';
import { ItemEdit, Items } from './screens/Items';
import { Owner, Transfer } from './screens/OwnerTransfer';
import { Payment } from './screens/Payment';
import { InvitePerson, People } from './screens/People';
import {
  ContactsReport,
  MoneyReport,
  ProfitReport,
  Reports,
  StockReport,
  WorthReport,
} from './screens/Reports';
import { Sell } from './screens/Sell';
import {
  DisplaySettings,
  ModeSettings,
  MoneyAccountEdit,
  MoneyAccounts,
  Settings,
  SyncSettings,
} from './screens/Settings';
import { Setup } from './screens/Setup';
import { SignIn } from './screens/SignIn';
import { Spend } from './screens/Spend';
import { BottomNav } from './ui/BottomNav';
import { ToastProvider } from './ui/Toast';

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/choose" element={<AuthGate />}>
              <Route index element={<ChooseBusiness />} />
            </Route>
            <Route path="/setup" element={<AuthGate />}>
              <Route index element={<Setup />} />
            </Route>
            <Route element={<Shell />}>
              <Route path="/" element={<Home />} />
              <Route path="/history" element={<History />} />
              <Route path="/items" element={<Items />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/reports" element={<Reports />} />
            </Route>
            <Route element={<Shell nav={false} />}>
              <Route path="/sell/:id?" element={<Sell />} />
              <Route path="/spend/:id?" element={<Spend />} />
              <Route path="/buy/:id?" element={<Buy />} />
              <Route path="/get-paid/:id?" element={<Payment kind="receivable" />} />
              <Route path="/pay/:id?" element={<Payment kind="payable" />} />
              <Route path="/owner/:id?" element={<Owner />} />
              <Route path="/transfer/:id?" element={<Transfer />} />
              <Route path="/items/:id" element={<ItemEdit />} />
              <Route path="/contacts/:id" element={<ContactDetail />} />
              <Route path="/contacts/:id/edit" element={<ContactEdit />} />
              <Route path="/contacts/new" element={<ContactEdit />} />
              <Route path="/documents/:id" element={<DocumentDetail />} />
              <Route path="/reports/money" element={<MoneyReport />} />
              <Route path="/reports/owed-to-me" element={<ContactsReport kind="receivable" />} />
              <Route path="/reports/i-owe" element={<ContactsReport kind="payable" />} />
              <Route path="/reports/profit" element={<ProfitReport />} />
              <Route path="/reports/stock" element={<StockReport />} />
              <Route path="/reports/worth" element={<WorthReport />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/mode" element={<ModeSettings />} />
              <Route path="/settings/accounts" element={<MoneyAccounts />} />
              <Route path="/settings/accounts/:id" element={<MoneyAccountEdit />} />
              <Route path="/settings/display" element={<DisplaySettings />} />
              <Route path="/settings/sync" element={<SyncSettings />} />
              <Route path="/settings/people" element={<People />} />
              <Route path="/settings/people/invite" element={<InvitePerson />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  );
}

/** Choosing or creating a business needs a signed-in user. */
function AuthGate() {
  const { auth, loading } = useSessionState();
  if (loading) return <Splash />;
  if (!auth) return <Navigate to="/sign-in" replace />;
  return <Outlet />;
}

/**
 * Everything inside the app needs an open business. Without one, a signed-in
 * user picks or creates a business; anyone else signs in first.
 */
function Shell({ nav = true }: { nav?: boolean }) {
  const { auth, session, loading } = useSessionState();
  if (loading) return <Splash />;
  if (!session) return <Navigate to={auth ? '/choose' : '/sign-in'} replace />;
  return (
    <div className={`app ${nav ? 'with-nav' : ''}`}>
      <Outlet />
      {nav ? <BottomNav /> : null}
    </div>
  );
}

function Splash() {
  const { t } = useTranslation();
  return (
    <div className="splash">
      <img src="/icons/icon.svg" alt="" width="72" height="72" />
      <div>{t('app.name')}</div>
    </div>
  );
}
