import { message } from 'antd';

import codeMessage from './codeMessage';

const TOAST_DURATION = 2;

const successHandler = (response, options = { notifyOnSuccess: false, notifyOnFailed: true }) => {
  const { data } = response;
  if (data && data.success === true) {
    const responseMessage = response.data && data.message;
    const successText = responseMessage || codeMessage[response.status];

    if (options.notifyOnSuccess) {
      message.success({
        content: successText,
        duration: TOAST_DURATION,
        className: 'hub-toast',
      });
    }
  } else {
    const responseMessage = response.data && data.message;
    const errorText = responseMessage || codeMessage[response.status];

    if (options.notifyOnFailed) {
      message.error({
        content: errorText,
        duration: TOAST_DURATION + 2,
        className: 'hub-toast hub-toast-error',
      });
    }
  }
};

export default successHandler;
