require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function test() {
  try {
    console.log('Checking Gmail SMTP...');

    await transporter.verify();

    console.log('✅ Gmail SMTP connection successful');

    await transporter.sendMail({
      from: `"${process.env.GMAIL_SENDER_NAME}" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: 'CLC CRM Test Email',
      text: 'Gmail SMTP is working successfully.',
    });

    console.log('✅ Test email sent successfully');
  } catch (error) {
    console.error('❌ Gmail SMTP ERROR:');
    console.error(error);
  }
}

test();
