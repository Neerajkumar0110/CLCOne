import React from 'react';
import { Form } from 'antd';

import useLanguage from '@/locale/useLanguage';
import OtpInput from '@/components/OtpInput';

export default function OtpForm({ email, onComplete }) {
  const translate = useLanguage();
  return (
    <div>
      <span className="auth-subtitle">
        {translate('A 6-digit code was sent to')} <strong>{email}</strong>
      </span>
      <Form.Item
        name="otp"
        rules={[
          { required: true, message: translate('Please enter the 6-digit code') },
          { pattern: /^[0-9]{6}$/, message: translate('Enter the 6-digit code') },
        ]}
      >
        <OtpInput length={6} onComplete={onComplete} />
      </Form.Item>
    </div>
  );
}
