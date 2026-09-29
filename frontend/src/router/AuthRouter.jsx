import { Routes, Route, Navigate } from 'react-router-dom';

import Login from '@/pages/Login';

import ForgetPassword from '@/pages/ForgetPassword';
import ResetPassword from '@/pages/ResetPassword';

import { useDispatch } from 'react-redux';

// Logging out from a deep link (e.g. the LMS Teacher/Student panel's own
// Logout button just dispatches logoutAction() with no navigation — see
// LmsPanelApp.jsx) leaves the URL wherever it was ('/teacher/assignments',
// '/sales/leads', ...) when IdurarOs.jsx reacts to isLoggedIn flipping false
// and swaps the whole tree over to this router. None of those deep paths are
// real routes here, so they used to fall through to NotFound (a confusing
// 404 right after logging out) instead of just showing the login page like
// every other unrecognized path should once you're signed out.
export default function AuthRouter() {
  const dispatch = useDispatch();

  return (
    <Routes>
      <Route element={<Login />} path="/" />
      <Route element={<Login />} path="/login" />
      <Route element={<Navigate to="/login" replace />} path="/logout" />
      <Route element={<ForgetPassword />} path="/forgetpassword" />
      <Route element={<ResetPassword />} path="/resetpassword/:userId/:resetToken" />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
