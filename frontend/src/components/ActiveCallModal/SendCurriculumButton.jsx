import React, { useState } from "react";
import { message } from "antd";
import { WhatsAppOutlined } from "@ant-design/icons";
import useWhatsAppAccess from "@/pages/WhatsApp/useWhatsAppAccess";
import waApi from "@/pages/WhatsApp/api";

// Call screen footer: "Send curriculum on WhatsApp". One click → from the
// caller's OWN linked WhatsApp, the number on this call gets a short welcome
// with the customer's name, then the InternX-AI curriculum PDF (Foundation +
// Elite). Backend: POST /api/whatsapp/send-curriculum. Shown only to users who
// have WhatsApp.
export default function SendCurriculumButton({ phone, name, leadId }) {
  const access = useWhatsAppAccess();
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState("");

  if (access.loading || !access.hasAccess) return null;
  const connected = access.device?.status === "connected";
  const already = !!phone && sentTo === phone;

  const send = async () => {
    if (!phone) return message.warning("This call has no phone number.");
    if (!connected) return message.warning("Your WhatsApp is not connected. Open the WhatsApp button in the header and scan the QR code first.");
    setSending(true);
    const res = await waApi.sendCurriculum({ phone, name, leadId });
    setSending(false);
    if (res?.success) {
      setSentTo(phone);
      message.success("Welcome message and curriculum PDF sent on WhatsApp");
    } else message.error(res?.message || "Could not send the curriculum.", 6);
  };

  return (
    <button
      type="button"
      className={`incall-btn-wa ${already ? "is-sent" : ""}`}
      disabled={sending}
      title={connected ? `Welcome + InternX-AI curriculum PDF, from your WhatsApp${access.device?.phoneNumber ? ` (+${access.device.phoneNumber})` : ""}` : "Link your WhatsApp first (header WhatsApp button)"}
      onClick={send}
    >
      {sending ? <span className="incall-btn-spin" aria-hidden="true" /> : <WhatsAppOutlined />}
      {sending ? "Sending…" : already ? "Curriculum sent · Send again" : "Send curriculum on WhatsApp"}
    </button>
  );
}
