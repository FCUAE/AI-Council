import { Resend } from 'resend';
import crypto from 'crypto';

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@askaicouncil.com';
const BASE_URL = 'https://askaicouncil.com';
const UNSUBSCRIBE_SECRET = process.env.SESSION_SECRET || process.env.REPL_ID || 'council-email-secret';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function generateUnsubscribeToken(userId: string): string {
  return crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(userId).digest('hex');
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const expected = generateUnsubscribeToken(userId);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

function unsubscribeFooter(userId: string): string {
  const token = generateUnsubscribeToken(userId);
  return `
    <p style="font-size: 12px; color: #9ca3af; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
      Don't want to receive these emails? <a href="${BASE_URL}/api/unsubscribe?uid=${encodeURIComponent(userId)}&token=${token}" style="color: #6b7280; text-decoration: underline;">Unsubscribe</a>
    </p>
  `;
}

function councilFooter(): string {
  return `<p style="font-size: 13px; color: #9ca3af; margin-top: 24px;">— The AI Council Team</p>`;
}

function tierLabel(tier: string): string {
  const labels: Record<string, string> = { explorer: 'Explorer', strategist: 'Strategist', mastermind: 'Mastermind', free: 'Free' };
  return labels[tier] || tier.charAt(0).toUpperCase() + tier.slice(1);
}

function wrapEmail(body: string): string {
  return `<div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a;">${body}</div>`;
}

function logError(context: string, error: unknown): void {
  if (process.env.NODE_ENV === "production") {
    const msg = error instanceof Error ? error.message : "unknown";
    console.error(`[email] Failed to send ${context}:`, msg);
  } else {
    console.error(`[email] Failed to send ${context}:`, error);
  }
}

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
  let resolvedFrom = fromEmail || 'AI Council <noreply@askaicouncil.com>';
  const emailMatch = resolvedFrom.match(/<([^>]+)>/);
  if (emailMatch) {
    resolvedFrom = `AI Council <${emailMatch[1]}>`;
  } else if (resolvedFrom.includes('@')) {
    resolvedFrom = `AI Council <${resolvedFrom}>`;
  }
  return {
    client: new Resend(apiKey),
    fromEmail: resolvedFrom
  };
}

export async function sendCreditExpiryWarning(
  email: string,
  userName: string | null,
  credits: number,
  daysLeft: number,
  packTier: string = 'explorer',
  userId?: string
): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');
    const safeCredits = escapeHtml(String(credits));
    const safeDaysLeft = escapeHtml(String(daysLeft));
    const tier = tierLabel(packTier);

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `Your ${safeCredits} credits expire in ${safeDaysLeft} days`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          Just a heads up — you have <strong>${safeCredits} unused credits</strong> that will expire in about <strong>${safeDaysLeft} days</strong>.
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
          Don't let them go to waste! Use them to get expert AI debates on any question — from business strategy to code architecture to marketing campaigns.
        </p>
        <a href="${BASE_URL}" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
          Use Your Credits
        </a>
        <p style="font-size: 13px; line-height: 1.5; color: #9ca3af; margin-top: 32px;">
          Buy a new pack and your remaining credits roll over automatically.
        </p>
        ${councilFooter()}
      `)
    });

    console.log(`[email] Sent expiry warning to ${email} (${credits} credits, ${daysLeft} days left, ${packTier})`);
    return true;
  } catch (error: unknown) {
    logError('expiry warning', error);
    return false;
  }
}

export async function sendCreditExpiryFinalWarning(
  email: string,
  userName: string | null,
  credits: number,
  packTier: string = 'explorer',
  userId?: string,
  usagePercent?: number
): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');
    const safeCredits = escapeHtml(String(credits));
    const tier = tierLabel(packTier);
    const showRecharge = usagePercent !== undefined && usagePercent >= 40;

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `⚠️ Your ${safeCredits} credits expire in 48 hours`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          ⏳ <strong>Your ${safeCredits} credits expire in less than 48 hours.</strong>
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
          Use them before they expire — start an AI debate on anything you've been thinking about.
        </p>
        ${showRecharge ? `
          <a href="${BASE_URL}/credits" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; margin-right: 12px;">
            Recharge & Save Credits
          </a>
        ` : ''}
        <a href="${BASE_URL}" style="display: inline-block; background: ${showRecharge ? '#ffffff' : '#1a1a1a'}; color: ${showRecharge ? '#1a1a1a' : '#ffffff'}; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; ${showRecharge ? 'border: 1px solid #e5e7eb;' : ''}">
          Use Your Credits
        </a>
        <p style="font-size: 13px; line-height: 1.5; color: #9ca3af; margin-top: 32px;">
          Buy a new pack and your remaining credits roll over automatically.
        </p>
        ${councilFooter()}
      `)
    });

    console.log(`[email] Sent final expiry warning to ${email} (${credits} credits, 48h left, ${packTier})`);
    return true;
  } catch (error: unknown) {
    logError('final expiry warning', error);
    return false;
  }
}

export async function sendCreditExpiredNotice(email: string, userName: string | null, expiredCredits: number, packTier: string = 'explorer'): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');
    const safeExpiredCredits = escapeHtml(String(expiredCredits));
    const tier = tierLabel(packTier);

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `Your ${safeExpiredCredits} credits have expired`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          Your <strong>${safeExpiredCredits} credits</strong> have expired.
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
          Grab a fresh credit pack and keep the debates going.
        </p>
        <a href="${BASE_URL}/credits" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
          Get More Credits
        </a>
        ${councilFooter()}
      `)
    });

    console.log(`[email] Sent expiry notice to ${email} (${expiredCredits} credits expired, ${packTier})`);
    return true;
  } catch (error: unknown) {
    logError('expiry notice', error);
    return false;
  }
}

export async function sendPurchaseConfirmation(
  email: string,
  userName: string | null,
  credits: number,
  packTier: string,
  expiresAt: Date,
  userId: string
): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');
    const tier = tierLabel(packTier);
    const expiryDate = expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `Your credit pack is ready — ${credits} credits loaded`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Welcome to the AI Council, ${name}!</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          Your <strong>credit pack</strong> is active with <strong>${credits} credits</strong>. Here's what to know:
        </p>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="font-size: 14px; color: #4b5563; margin: 0 0 8px 0;">📅 <strong>Expires:</strong> ${expiryDate}</p>
          <p style="font-size: 14px; color: #4b5563; margin: 0 0 8px 0;">⚡ <strong>Each debate:</strong> 2 credits (depending on models used)</p>
          <p style="font-size: 14px; color: #4b5563; margin: 0;">🔄 <strong>Rollover:</strong> Buy a new pack anytime and unused credits carry over</p>
        </div>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 8px;"><strong>Starter prompts to try:</strong></p>
        <ul style="font-size: 14px; line-height: 1.8; color: #4b5563; margin-bottom: 24px; padding-left: 20px;">
          <li>"Should I start a newsletter or a podcast?"</li>
          <li>"Is React or Vue better for my SaaS product?"</li>
          <li>"What's the best pricing strategy for a new product?"</li>
        </ul>
        <a href="${BASE_URL}" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
          Start Your First Debate
        </a>
        ${councilFooter()}
        ${unsubscribeFooter(userId)}
      `)
    });

    console.log(`[email] Sent purchase confirmation to ${email} (${credits} credits, ${packTier})`);
    return true;
  } catch (error: unknown) {
    logError('purchase confirmation', error);
    return false;
  }
}

export async function sendEngagementNudge(
  email: string,
  userName: string | null,
  credits: number,
  daysLeft: number,
  packTier: string,
  userId: string
): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');
    const tier = tierLabel(packTier);

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `You still have ${credits} credits — here are some ideas`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          You have <strong>${credits} unused credits</strong> with about <strong>${daysLeft} days</strong> left. Not sure what to ask the AI Council?
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 8px;"><strong>Popular questions this week:</strong></p>
        <ul style="font-size: 14px; line-height: 1.8; color: #4b5563; margin-bottom: 24px; padding-left: 20px;">
          <li>"What's the best way to validate a business idea?"</li>
          <li>"Should I hire or outsource my next project?"</li>
          <li>"How do I prioritize features for my MVP?"</li>
        </ul>
        <a href="${BASE_URL}" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
          Use Your Credits
        </a>
        ${councilFooter()}
        ${unsubscribeFooter(userId)}
      `)
    });

    console.log(`[email] Sent engagement nudge to ${email} (${credits} credits, ${packTier})`);
    return true;
  } catch (error: unknown) {
    logError('engagement nudge', error);
    return false;
  }
}

export async function sendPostExpiryReengagement(
  email: string,
  userName: string | null,
  expiredCredits: number,
  packTier: string,
  userId: string
): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');
    const tier = tierLabel(packTier);

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `Miss the AI Council? Grab a fresh credit pack`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          Your credits expired, but you can pick up right where you left off with a new pack.
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
          The AI Council is ready whenever you are — just bring a question.
        </p>
        <a href="${BASE_URL}/credits" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
          Get More Credits
        </a>
        ${councilFooter()}
        ${unsubscribeFooter(userId)}
      `)
    });

    console.log(`[email] Sent post-expiry re-engagement to ${email} (${packTier})`);
    return true;
  } catch (error: unknown) {
    logError('post-expiry re-engagement', error);
    return false;
  }
}

export async function sendDormancyFinalNotice(
  email: string,
  userName: string | null,
  credits: number,
  packTier: string,
  userId: string
): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');
    const tier = tierLabel(packTier);

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `⚠️ Your credit balance of ${credits} credits will be removed in 5 days`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          Your <strong>credit balance of ${credits} credits</strong> will be permanently removed in <strong>5 days</strong>. After that, they cannot be recovered.
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
          Purchase a new pack now to save them — your remaining credits will roll over into the new pack automatically.
        </p>
        <a href="${BASE_URL}/credits" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
          Recharge & Save Credits
        </a>
        ${councilFooter()}
      `)
    });

    console.log(`[email] Sent dormancy final notice to ${email} (${credits} credits, ${packTier})`);
    return true;
  } catch (error: unknown) {
    logError('dormancy final notice', error);
    return false;
  }
}

export async function sendFreeWelcome(email: string, userName: string | null, credits: number, userId: string): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `Welcome to AI Council — you have ${credits} free credits`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Welcome, ${name}!</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          You've just joined AI Council with <strong>${credits} free credits</strong>. Each debate costs 2 credits, so you have enough for ${Math.floor(credits / 2)} debates.
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 8px;"><strong>How it works:</strong></p>
        <ul style="font-size: 14px; line-height: 1.8; color: #4b5563; margin-bottom: 24px; padding-left: 20px;">
          <li>Ask any question and get perspectives from multiple AI models</li>
          <li>The AI Council debates, then a chairman synthesizes the best answer</li>
          <li>Great for business decisions, tech questions, creative projects, and more</li>
        </ul>
        <a href="${BASE_URL}" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
          Start Your First Debate
        </a>
        ${councilFooter()}
        ${unsubscribeFooter(userId)}
      `)
    });

    console.log(`[email] Sent free welcome to ${email} (${credits} credits)`);
    return true;
  } catch (error: unknown) {
    logError('free welcome', error);
    return false;
  }
}

export async function sendFreeExpiredConversion(email: string, userName: string | null, userId: string): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `Your free credits expired — unlock the full AI Council`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          Your free credits have expired, but you can keep the debates going with a credit pack. Plans start at just $29 for 100 credits (up to 50 debates)*.
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
          Upgrade now and get access to all AI models.
        </p>
        <a href="${BASE_URL}/credits" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
          Get More Credits
        </a>
        ${councilFooter()}
        ${unsubscribeFooter(userId)}
      `)
    });

    console.log(`[email] Sent free expired conversion to ${email}`);
    return true;
  } catch (error: unknown) {
    logError('free expired conversion', error);
    return false;
  }
}

export async function sendConsolidatedExpiryWarning(
  email: string,
  userName: string | null,
  primaryBatch: { credits: number; daysLeft: number; packTier: string },
  secondaryBatches: { credits: number; daysLeft: number; packTier: string }[]
): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const name = escapeHtml(userName || 'there');
    const tier = tierLabel(primaryBatch.packTier);

    const secondarySection = secondaryBatches.length > 0
      ? `
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="font-size: 14px; color: #4b5563; margin: 0 0 8px 0;"><strong>Also expiring soon:</strong></p>
          ${secondaryBatches.map(b => `
            <p style="font-size: 13px; color: #6b7280; margin: 4px 0;">${b.credits} credits — ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left</p>
          `).join('')}
        </div>
      `
      : '';

    await client.emails.send({
      from: fromEmail,
      to: email,
      subject: `Your ${primaryBatch.credits} credits expire in ${primaryBatch.daysLeft} days`,
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Hey ${name},</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 16px;">
          Your <strong>${primaryBatch.credits} credits</strong> expire in about <strong>${primaryBatch.daysLeft} days</strong>.
        </p>
        ${secondarySection}
        <p style="font-size: 15px; line-height: 1.6; color: #4b5563; margin-bottom: 24px;">
          Don't let them go to waste — start a debate today.
        </p>
        <a href="${BASE_URL}" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px;">
          Use Your Credits
        </a>
        ${councilFooter()}
      `)
    });

    console.log(`[email] Sent consolidated expiry warning to ${email} (primary: ${primaryBatch.credits} credits, +${secondaryBatches.length} secondary)`);
    return true;
  } catch (error: unknown) {
    logError('consolidated expiry warning', error);
    return false;
  }
}

export async function sendSupportMessage(senderEmail: string, message: string, imageUrls?: string[]): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();

    const safeSenderEmail = escapeHtml(senderEmail);
    const safeMessage = escapeHtml(message);

    const imageSection = imageUrls && imageUrls.length > 0
      ? `
        <div style="margin-top: 16px;">
          <p style="font-size: 14px; color: #6b7280; margin-bottom: 8px;"><strong>Attachments (${imageUrls.length}):</strong></p>
          ${imageUrls.map((url, i) => `
            <div style="margin-bottom: 8px;">
              <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color: #2563eb; font-size: 14px; text-decoration: underline;">View image ${i + 1}</a>
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
      html: wrapEmail(`
        <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">New support message</h2>
        <p style="font-size: 14px; color: #6b7280; margin-bottom: 8px;"><strong>From:</strong> ${safeSenderEmail}</p>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-top: 12px;">
          <p style="font-size: 15px; line-height: 1.6; color: #1a1a1a; white-space: pre-wrap; margin: 0;">${safeMessage}</p>
        </div>
        ${imageSection}
      `)
    });

    console.log(`[email] Sent support message from ${senderEmail}`);
    return true;
  } catch (error: unknown) {
    logError('support message', error);
    return false;
  }
}
