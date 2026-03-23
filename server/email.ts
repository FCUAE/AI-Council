import { Resend } from 'resend';

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@askaicouncil.com';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || !connectionSettings.settings.api_key) {
    throw new Error('Resend not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, fromEmail: connectionSettings.settings.from_email };
}

async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail: fromEmail || 'Council <noreply@askaicouncil.com>'
  };
}

export async function sendCreditExpiryWarning(email: string, userName: string | null, credits: number, daysLeft: number): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = userName || 'there';

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `Your ${credits} AI Council credits expire in ${daysLeft} days`,
      html: `
        <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a;">
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
            Just a heads up — you have <strong>${credits} unused credits</strong> on AI Council that will expire in about <strong>${daysLeft} days</strong>.
          </p>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
            Don't let them go to waste! Use them to get expert AI debates on any question — from business strategy to code architecture to marketing campaigns.
          </p>
          <a href="https://askaicouncil.com" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
            Use Your Credits
          </a>
          <p style="font-size: 13px; line-height: 1.5; color: #9ca3af; margin-top: 32px;">
            Credits are valid for 60 days from purchase. If you need more time, purchasing a new pack will reset your expiration timer.
          </p>
          <p style="font-size: 13px; color: #9ca3af; margin-top: 24px;">— The Council Team</p>
        </div>
      `
    });

    console.log(`[email] Sent expiry warning to ${email} (${credits} credits, ${daysLeft} days left)`);
    return true;
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      const msg = error instanceof Error ? error.message : "unknown";
      console.error(`[email] Failed to send expiry warning:`, msg);
    } else {
      console.error(`[email] Failed to send expiry warning:`, error);
    }
    return false;
  }
}

export async function sendCreditExpiryFinalWarning(email: string, userName: string | null, credits: number): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = userName || 'there';

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `⚠️ Your ${credits} AI Council credits expire in 48 hours`,
      html: `
        <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a;">
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
            ⏳ <strong>Your ${credits} credits expire in less than 48 hours.</strong>
          </p>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
            Once they're gone, they're gone — but you can save them. <strong>Purchase any credit pack now and your entire balance (including your current ${credits} credits) gets a fresh 60-day window.</strong>
          </p>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
            Or use them before they expire — start an AI debate on anything you've been thinking about.
          </p>
          <a href="https://askaicouncil.com/credits" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; margin-right: 12px;">
            Recharge & Save Credits
          </a>
          <a href="https://askaicouncil.com" style="display: inline-block; background: #ffffff; color: #1a1a1a; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
            Use Your Credits
          </a>
          <p style="font-size: 13px; line-height: 1.5; color: #9ca3af; margin-top: 32px;">
            Buying any pack resets the 60-day timer for your entire credit balance — nothing is lost.
          </p>
          <p style="font-size: 13px; color: #9ca3af; margin-top: 24px;">— The Council Team</p>
        </div>
      `
    });

    console.log(`[email] Sent final expiry warning to ${email} (${credits} credits, 48h left)`);
    return true;
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      const msg = error instanceof Error ? error.message : "unknown";
      console.error(`[email] Failed to send final expiry warning:`, msg);
    } else {
      console.error(`[email] Failed to send final expiry warning:`, error);
    }
    return false;
  }
}

export async function sendSupportMessage(senderEmail: string, message: string, imageUrls?: string[]): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();

    const imageSection = imageUrls && imageUrls.length > 0
      ? `
        <div style="margin-top: 16px;">
          <p style="font-size: 14px; color: #6b7280; margin-bottom: 8px;"><strong>Attachments (${imageUrls.length}):</strong></p>
          ${imageUrls.map((url, i) => `
            <div style="margin-bottom: 8px;">
              <a href="${url}" target="_blank" rel="noopener" style="color: #2563eb; font-size: 14px; text-decoration: underline;">View image ${i + 1}</a>
            </div>
          `).join('')}
        </div>
      `
      : '';

    await client.emails.send({
      from: fromEmail,
      to: SUPPORT_EMAIL,
      replyTo: senderEmail,
      subject: `Support message from ${senderEmail}`,
      html: `
        <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a;">
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">New support message</h2>
          <p style="font-size: 14px; color: #6b7280; margin-bottom: 8px;"><strong>From:</strong> ${senderEmail}</p>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-top: 12px;">
            <p style="font-size: 15px; line-height: 1.6; color: #1a1a1a; white-space: pre-wrap; margin: 0;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          </div>
          ${imageSection}
        </div>
      `
    });

    console.log(`[email] Sent support message from ${senderEmail}`);
    return true;
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      const msg = error instanceof Error ? error.message : "unknown";
      console.error(`[email] Failed to send support message:`, msg);
    } else {
      console.error(`[email] Failed to send support message:`, error);
    }
    return false;
  }
}

export async function sendCreditExpiredNotice(email: string, userName: string | null, expiredCredits: number): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = userName || 'there';

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `Your AI Council credits have expired`,
      html: `
        <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a;">
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
            Your <strong>${expiredCredits} AI Council credits</strong> have expired after 60 days of inactivity.
          </p>
          <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
            Ready to get back to smarter decisions? Grab a fresh credit pack and put the world's best AI models to work on your toughest problems.
          </p>
          <a href="https://askaicouncil.com/credits" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
            Get More Credits
          </a>
          <p style="font-size: 13px; color: #9ca3af; margin-top: 32px;">— The Council Team</p>
        </div>
      `
    });

    console.log(`[email] Sent expiry notice to ${email} (${expiredCredits} credits expired)`);
    return true;
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      const msg = error instanceof Error ? error.message : "unknown";
      console.error(`[email] Failed to send expiry notice:`, msg);
    } else {
      console.error(`[email] Failed to send expiry notice:`, error);
    }
    return false;
  }
}
