import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import { PublicLayout } from "@/components/vs/Layout";
import AppShell, { RequireAuth } from "@/components/vs/AppShell";
import Home from "@/pages/public/Home";
import Login from "@/pages/public/Login";
import Register from "@/pages/public/Register";
import ForgotPassword from "@/pages/public/ForgotPassword";
import ResetPassword from "@/pages/public/ResetPassword";
import Privacy from "@/pages/public/Privacy";
import PublicResults from "@/pages/public/PublicResults";
import ChangePassword from "@/pages/account/ChangePassword";
import Settings from "@/pages/account/Settings";
import StudentDashboard from "@/pages/student/StudentDashboard";
import BallotPage from "@/pages/student/BallotPage";
import AdminOverview from "@/pages/admin/AdminOverview";
import Verification from "@/pages/admin/Verification";
import Registry from "@/pages/admin/Registry";
import Students from "@/pages/admin/Students";
import Elections from "@/pages/admin/Elections";
import ElectionDetail from "@/pages/admin/ElectionDetail";
import Approvals from "@/pages/admin/Approvals";
import StaffUsers from "@/pages/admin/StaffUsers";
import SecurityCenter from "@/pages/admin/SecurityCenter";
import AuditLog from "@/pages/auditor/AuditLog";
import AuditorOverview from "@/pages/auditor/AuditorOverview";
import AuditorResults from "@/pages/auditor/AuditorResults";
import OpsDashboard from "@/pages/ops/OpsDashboard";

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/results" element={<PublicResults />} />
          </Route>
          <Route element={<RequireAuth allowPasswordChange />}>
            <Route path="/app/change-password" element={<ChangePassword />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/app/settings" element={<Settings />} />
              <Route element={<RequireAuth roles={["student"]} />}>
                <Route path="/app/student" element={<StudentDashboard />} />
                <Route path="/app/student/elections/:id" element={<BallotPage />} />
                <Route path="/app/results" element={<PublicResults embedded />} />
              </Route>
              <Route element={<RequireAuth roles={["admin"]} />}>
                <Route path="/app/admin" element={<AdminOverview />} />
                <Route path="/app/admin/verification" element={<Verification />} />
                <Route path="/app/admin/registry" element={<Registry />} />
                <Route path="/app/admin/students" element={<Students />} />
                <Route path="/app/admin/elections" element={<Elections />} />
                <Route path="/app/admin/approvals" element={<Approvals />} />
                <Route path="/app/admin/users" element={<StaffUsers />} />
                <Route path="/app/admin/security" element={<SecurityCenter />} />
              </Route>
              <Route element={<RequireAuth roles={["admin", "auditor"]} />}>
                <Route path="/app/elections/:id" element={<ElectionDetail />} />
                <Route path="/app/audit" element={<AuditLog />} />
              </Route>
              <Route element={<RequireAuth roles={["auditor"]} />}>
                <Route path="/app/auditor" element={<AuditorOverview />} />
                <Route path="/app/auditor/results" element={<AuditorResults />} />
              </Route>
              <Route element={<RequireAuth roles={["operator"]} />}>
                <Route path="/app/ops" element={<OpsDashboard />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors theme="dark" position="top-right" />
    </AuthProvider>
  );
}
