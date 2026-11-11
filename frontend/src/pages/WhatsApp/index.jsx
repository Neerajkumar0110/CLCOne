import React from 'react';
import { Spin } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import useWhatsAppAccess from './useWhatsAppAccess';
import Inbox from './Inbox';
import AccessAdmin from './AccessAdmin';
import { PageHeader } from './ui';
import './whatsapp.css';

// Messenger › WhatsApp. Every user with access gets their Inbox (link a
// number by QR, chat with customers). CRM admins get the Access workspace
// (Individual / Department / Live Chats / My Inbox). Backend: /api/whatsapp.
export default function WhatsApp() {
  const acc = useWhatsAppAccess();

  if (acc.loading) {
    return (
      <div className="wa-page">
        <PageHeader />
        <div className="wa-card wa-center" style={{ minHeight: 280 }}>
          <Spin />
        </div>
      </div>
    );
  }

  if (!acc.hasAccess) {
    return (
      <div className="wa-page">
        <PageHeader />
        <div className="wa-card wa-center wa-locked">
          <LockOutlined className="wa-locked-icon" />
          <h2>WhatsApp is not turned on for you</h2>
          <p>Ask an admin to give you WhatsApp access.</p>
        </div>
      </div>
    );
  }

  if (acc.isAdmin) return <AccessAdmin me={acc} />;

  return (
    <div className="wa-page">
      <PageHeader />
      <div className="wa-card">
        <Inbox initialDevice={acc.device} configured={acc.configured} embedded />
      </div>
    </div>
  );
}
