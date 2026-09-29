import { useEffect, useLayoutEffect } from 'react';
import { useDispatch } from 'react-redux';
import { logout as logoutAction } from '@/redux/auth/actions';
import { crud } from '@/redux/crud/actions';
import { erp } from '@/redux/erp/actions';
import PageLoader from '@/components/PageLoader';

// No manual navigate('/login') here on purpose. logoutAction() dispatches
// LOGOUT_SUCCESS synchronously, flipping isLoggedIn — IdurarOs.jsx reacts to
// that by swapping its whole tree from the authenticated app (ErpApp, whose
// own route table only has '/login' as a redirect back to '/') to AuthRouter
// (which maps '/logout' itself straight to '/login'). Calling navigate('/login')
// here raced that swap: React Router matched '/login' against the
// still-mounted authenticated route table for one tick, bounced through its
// '/' redirect before the tree had swapped, and landed on a 404.
const Logout = () => {
  const dispatch = useDispatch();

  useLayoutEffect(() => {
    dispatch(crud.resetState());
    dispatch(erp.resetState());
  }, []);

  useEffect(() => {
    dispatch(logoutAction());
  }, []);

  return <PageLoader />;
};
export default Logout;
