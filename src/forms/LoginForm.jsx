import React from 'react';
import { Form, Input, Checkbox } from 'antd';
import { UserOutlined } from '@ant-design/icons';

import useLanguage from '@/locale/useLanguage';

export default function LoginForm() {
  const translate = useLanguage();
  return (
    <div>
      <Form.Item
        label={translate('email')}
        name="email"
        rules={[
          {
            required: true,
          },
          {
            type: 'email',
          },
        ]}
      >
        <Input
          className="auth-input-underline"
          prefix={<UserOutlined className="site-form-item-icon" />}
          placeholder={'you@company.com'}
          type="email"
          size="large"
        />
      </Form.Item>

      <Form.Item name="remember" valuePropName="checked" noStyle>
        <Checkbox>{translate('Remember me')}</Checkbox>
      </Form.Item>
    </div>
  );
}
