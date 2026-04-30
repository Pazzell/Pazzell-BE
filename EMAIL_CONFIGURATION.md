# Email Configuration Guide

This application supports multiple email providers. You can easily switch between Gmail and Twilio SendGrid by setting environment variables.

## Environment Variables

### Switching Between Providers

Set the `EMAIL_PROVIDER` environment variable to choose your email service:

- `EMAIL_PROVIDER=gmail` - Use Gmail SMTP (default if not set)
- `EMAIL_PROVIDER=twilio` - Use Twilio SendGrid SMTP

---

## Option 1: Gmail SMTP Configuration

### Environment Variables for Gmail:

```env
EMAIL_PROVIDER=gmail

# Gmail SMTP Settings
SMTP_SERVICE=gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_MAIL=your-email@gmail.com
SMTP_PASSWORD=your-app-specific-password
```

### Important Notes for Gmail:
1. **You MUST use an App Password**, not your regular Gmail password
2. To create an App Password:
   - Go to your Google Account settings
   - Enable 2-Factor Authentication (2FA)
   - Go to Security → 2-Step Verification → App passwords
   - Generate a new app password for "Mail"
   - Use that 16-character password as `SMTP_PASSWORD`

---

## Option 2: Twilio SendGrid Configuration

### Environment Variables for Twilio SendGrid:

```env
EMAIL_PROVIDER=twilio

# Twilio SendGrid SMTP Settings
TWILIO_SMTP_HOST=smtp.sendgrid.net
TWILIO_SMTP_PORT=587
TWILIO_SMTP_USER=apikey
TWILIO_SMTP_PASSWORD=your-sendgrid-api-key
TWILIO_SMTP_FROM=noreply@yourdomain.com
```

### How to Get Twilio SendGrid Credentials:

1. **Login to Twilio/SendGrid Console**:
   - Go to https://sendgrid.com or https://console.twilio.com

2. **Create an API Key**:
   - Navigate to Settings → API Keys
   - Click "Create API Key"
   - Give it a name (e.g., "Production SMTP")
   - Select "Full Access" or "Restricted Access" with Mail Send permissions
   - Copy the API Key (this is your `TWILIO_SMTP_PASSWORD`)

3. **Verify Sender Identity**:
   - Go to Settings → Sender Authentication
   - Verify either a single sender email or your entire domain
   - Use the verified email as `TWILIO_SMTP_FROM`

### Important Notes for Twilio SendGrid:
- The username is always `apikey` (literal string)
- The password is your SendGrid API Key
- You must verify your sender email/domain before sending
- Port 587 is recommended for cloud platforms like Render

---

## Setting Environment Variables on Render

1. Go to your Render Dashboard
2. Select your web service
3. Go to "Environment" tab
4. Add the environment variables based on which provider you want to use
5. Click "Save Changes"
6. Render will automatically redeploy your service

---

## Testing Your Configuration

After setting up your environment variables and deploying:

1. Try creating a new account
2. Check if the verification email is sent successfully
3. If it fails, check the logs on Render for specific error messages

---

## Troubleshooting

### Gmail Issues:
- **"Invalid credentials"**: Make sure you're using an App Password, not your regular password
- **"Less secure app"**: Enable 2FA and use App Password instead
- **Connection timeout**: Gmail may be blocked on your platform, try Twilio SendGrid

### Twilio SendGrid Issues:
- **"Authentication failed"**: Verify your API key is correct
- **"Sender not verified"**: Verify your sender email in SendGrid dashboard
- **"Connection refused"**: Check if port 587 is accessible from your platform

### General Issues:
- **ENOENT error**: File path issue (already fixed)
- **ETIMEDOUT**: SMTP server unreachable - try different port or provider
- **ECONNREFUSED**: Port blocked - use port 587 or 465

---

## Recommended Setup for Production

For production environments like Render, **Twilio SendGrid is recommended** because:
- More reliable on cloud platforms
- Better deliverability rates
- No 2FA requirements
- Free tier available (100 emails/day)
- Professional sender reputation
