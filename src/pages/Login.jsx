import { useEffect, useRef, useState } from 'react';

import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import useLanguage from '@/locale/useLanguage';

import { Form, Button, ConfigProvider, message } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';

import { login, verifyOtp, resendOtp, cancelOtp } from '@/redux/auth/actions';
import { selectAuth } from '@/redux/auth/selectors';
import LoginForm from '@/forms/LoginForm';
import OtpForm from '@/forms/OtpForm';
import Loading from '@/components/Loading';
import AuthModule from '@/modules/AuthModule';

const RESEND_COOLDOWN = 30;

const LoginPage = () => {
  const translate = useLanguage();
  const { isLoading, isSuccess, otpRequired, otpEmail } = useSelector(selectAuth);
  const navigate = useNavigate();

  const dispatch = useDispatch();
  const [remember, setRemember] = useState(true);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const otpFormRef = useRef(null);

  const onFinishLogin = (values) => {
    setRemember(values.remember);
    dispatch(login({ loginData: values }));
  };

  const onFinishOtp = (values) => {
    dispatch(verifyOtp({ email: otpEmail, otp: values.otp, remember }));
  };

  const onResendOtp = async () => {
    setResending(true);
    await dispatch(resendOtp({ email: otpEmail }));
    setResending(false);
    setCooldown(RESEND_COOLDOWN);
    message.open({
      content: translate('Code resent to your email'),
      icon: <CheckCircleFilled style={{ color: '#0e7490' }} />,
      duration: 2,
      className: 'hub-toast',
    });
  };

  useEffect(() => {
    if (isSuccess) navigate('/');
  }, [isSuccess]);

  // Fires once, right when the email step succeeds and the OTP step opens
  // — not on every render, since this only re-runs when otpRequired
  // actually flips from false to true.
  useEffect(() => {
    if (otpRequired) {
      setCooldown(RESEND_COOLDOWN);
      message.open({
        content: translate('OTP sent to your email'),
        icon: <CheckCircleFilled style={{ color: '#0e7490' }} />,
        duration: 2,
        className: 'hub-toast',
      });
    }
  }, [otpRequired]);

  // Ticks the resend cooldown once a second — must NOT remount the OTP
  // form on every tick, so this only ever touches `cooldown` state; the
  // step JSX below is inlined (not a nested component function) so React
  // just updates props on re-render instead of tearing the form down.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#0e7490', borderRadius: 10 } }}>
      <div className="auth-page-in">
        <AuthModule
          authContent={
            otpRequired ? (
              <div className="auth-step" key="otp-step">
                <Loading isLoading={isLoading}>
                  <Form
                    ref={otpFormRef}
                    layout="vertical"
                    name="verify_otp"
                    className="login-form"
                    onFinish={onFinishOtp}
                  >
                    <OtpForm email={otpEmail} onComplete={() => otpFormRef.current?.submit()} />
                    <Form.Item style={{ marginBottom: 14 }}>
                      <Button
                        type="primary"
                        htmlType="submit"
                        className="login-form-button"
                        loading={isLoading}
                        size="large"
                      >
                        {translate('Verify')}
                      </Button>
                    </Form.Item>
                  </Form>
                  <div className="auth-link-row">
                    <Button type="link" onClick={onResendOtp} loading={resending} disabled={isLoading || cooldown > 0}>
                      {cooldown > 0 ? `${translate('Resend code')} (${cooldown}s)` : translate('Resend code')}
                    </Button>
                    <span style={{ color: 'var(--hub-border-strong, #d0d5dd)' }}>·</span>
                    <Button type="link" onClick={() => dispatch(cancelOtp())} disabled={isLoading}>
                      {translate('Back')}
                    </Button>
                  </div>
                </Loading>
              </div>
            ) : (
              <div className="auth-step" key="login-step">
                <span className="auth-subtitle">
                  {translate('Enter your email — we will send you a login code')}
                </span>
                <Loading isLoading={isLoading}>
                  <Form
                    layout="vertical"
                    name="normal_login"
                    className="login-form"
                    initialValues={{ remember: true }}
                    onFinish={onFinishLogin}
                  >
                    <LoginForm />
                    <Form.Item style={{ marginBottom: 0 }}>
                      <Button
                        type="primary"
                        htmlType="submit"
                        className="login-form-button"
                        loading={isLoading}
                        size="large"
                      >
                        {translate('Send code')}
                      </Button>
                    </Form.Item>
                  </Form>
                </Loading>
              </div>
            )
          }
          AUTH_TITLE={otpRequired ? 'Verify Your Code' : 'Login Your Account'}
        />
      </div>
    </ConfigProvider>
  );
};

export default LoginPage;
