import { message } from 'antd';
import codeMessage from './codeMessage';

const TOAST_DURATION = 3;

// One shared toast style app-wide (same pill look as the login page's "OTP
// sent" toast — see .hub-toast in style/partials/featureHub.css) instead of
// antd's default notification card, and no raw "Request error 403" prefix —
// just the actual human-readable message.
function showError(text) {
  message.error({
    content: text,
    duration: TOAST_DURATION,
    className: 'hub-toast hub-toast-error',
  });
}

const errorHandler = (error) => {
  if (!navigator.onLine) {
    showError('Cannot connect to the Internet — check your network.');
    return {
      success: false,
      result: null,
      message: 'Cannot connect to the server, Check your internet network',
    };
  }

  const { response } = error;

  if (!response) {
    return {
      success: false,
      result: null,
      message: 'Cannot connect to the server, Contact your Account administrator',
    };
  }

  if (response && response.data && response.data.jwtExpired) {
    const result = window.localStorage.getItem('auth');
    const jsonFile = window.localStorage.getItem('isLogout');
    const { isLogout } = (jsonFile && JSON.parse(jsonFile)) || false;
    window.localStorage.removeItem('auth');
    window.localStorage.removeItem('isLogout');
    if (result || isLogout) {
      window.location.href = '/logout';
    }
  }

  if (response && response.status) {
    const responseMessage = response.data && response.data.message;
    const errorText = responseMessage || codeMessage[response.status];

    showError(errorText);

    if (response?.data?.error?.name === 'JsonWebTokenError') {
      window.localStorage.removeItem('auth');
      window.localStorage.removeItem('isLogout');
      window.location.href = '/logout';
    } else return response.data;
  } else if (navigator.onLine) {
    showError('Cannot connect to the server — try again later.');
    return {
      success: false,
      result: null,
      message: 'Cannot connect to the server, Contact your Account administrator',
    };
  } else {
    showError('No internet connection — check your network.');
    return {
      success: false,
      result: null,
      message: 'Cannot connect to the server, Check your internet network',
    };
  }
};

export default errorHandler;
