import type { Metadata } from "next";
import { LegalPage } from "@/components/public/public-chrome";

export const metadata: Metadata = { title: "Privacy policy" };

/**
 * Privacy policy. Placeholders in [BRACKETS] must be replaced before launch
 * ([APP_NAME], [COMPANY], [EMAIL], [PHONE], [CITY]). Not legal advice — have
 * it checked by a lawyer.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="[DATE]">
      <p>
        This policy explains what information <strong>[APP_NAME]</strong> (“we”), operated by [COMPANY], [CITY], Pakistan, collects when restaurants
        use our service and when their customers order from them on WhatsApp or on a restaurant&apos;s menu page, and how we use it.
      </p>

      <h2>Who is responsible for what</h2>
      <ul>
        <li>
          <strong>Restaurants</strong> decide which customer information they collect and keep. For customer orders, the restaurant is responsible
          for that data; we process it on the restaurant&apos;s behalf.
        </li>
        <li>
          <strong>We</strong> are responsible for the accounts of restaurant owners and staff, billing, and keeping the service secure.
        </li>
      </ul>

      <h2>What we collect</h2>
      <ul>
        <li>Restaurant and staff accounts: names, email addresses, phone numbers, roles and login activity.</li>
        <li>
          Customer orders: name, phone number, delivery address or location pin, the items ordered, payment method and order history at that
          restaurant.
        </li>
        <li>
          WhatsApp conversations with a restaurant&apos;s number: messages, photos, voice notes and their written transcripts, so the AI assistant
          and staff can take the order.
        </li>
        <li>Menu page visits: counted per day without storing your IP address (we keep a one-way scrambled code for about two days to stop abuse).</li>
        <li>Error and security logs. Phone numbers, emails and tokens in logs are masked.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To take, prepare and deliver orders, and to send order updates on WhatsApp.</li>
        <li>To let the AI assistant understand messages and voice notes. Text and audio are sent to our AI provider only to produce a reply or a transcript.</li>
        <li>To give restaurants reports about their own business.</li>
        <li>To bill restaurants and keep the service safe (rate limits, fraud and abuse checks).</li>
      </ul>
      <p>We do not sell personal data and we do not use customer data for advertising.</p>

      <h2>Who we share it with</h2>
      <ul>
        <li>The restaurant you ordered from (and only that restaurant).</li>
        <li>Service providers that run the service for us: hosting and database, WhatsApp (Meta), the AI provider, email, and error monitoring.</li>
        <li>Authorities, when the law requires it.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        Orders are kept while the restaurant uses [APP_NAME], so it can see its history and reports. Unused menu-page carts are deleted after 90
        days. A restaurant can ask us to delete its account and data when it leaves.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          Customers can ask the restaurant (or us at [EMAIL]) to delete their data. We then remove their name, phone number, addresses, messages,
          voice notes and photos. Past orders stay in the restaurant&apos;s totals as “Deleted customer”.
        </li>
        <li>You can stop receiving messages by not messaging the restaurant&apos;s WhatsApp number. We only reply inside WhatsApp&apos;s 24-hour window.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit. Each restaurant can only see its own data. WhatsApp access tokens are encrypted. Staff accounts have roles so
        each person sees only what they need.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy: [EMAIL] · [PHONE]. If this policy changes, we will update the date at the top of this page.
      </p>
    </LegalPage>
  );
}
