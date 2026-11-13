import type { Metadata } from "next";
import { LegalPage } from "@/components/public/public-chrome";

export const metadata: Metadata = { title: "Terms of service" };

/**
 * Terms of service for restaurants. Replace the [PLACEHOLDERS] before launch
 * and have a lawyer check them. Simple wording on purpose.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="[DATE]">
      <p>
        These terms are an agreement between [COMPANY] (“we”), the operator of <strong>[APP_NAME]</strong>, and the restaurant that signs up
        (“you”). By using [APP_NAME] you agree to them.
      </p>

      <h2>1. The service</h2>
      <p>
        [APP_NAME] lets your restaurant take orders on WhatsApp with an AI assistant, manage orders, the kitchen, riders, your menu and customers,
        and see reports. We may improve or change features over time.
      </p>

      <h2>2. Free trial and subscription</h2>
      <ul>
        <li>New restaurants get a free trial. The length is shown in your billing page.</li>
        <li>After the trial, the service is paid monthly according to your plan. Prices are shown on our website and in your billing page.</li>
        <li>Plans have limits (branches, orders and AI chats per month). If you go over, we will contact you about a bigger plan; we do not stop orders automatically.</li>
      </ul>

      <h2>3. Payments</h2>
      <ul>
        <li>You pay in advance for each month by bank transfer, JazzCash, Easypaisa or cash, using the details in your billing page.</li>
        <li>Each payment adds one month. You get a receipt for every payment.</li>
        <li>
          If payment is late, you get a grace period. After it, the account is suspended: online ordering stops, but your data is kept. Paying
          switches it back on.
        </li>
        <li>Payments are not refundable for months already started, unless we agree otherwise in writing.</li>
      </ul>

      <h2>4. Your responsibilities</h2>
      <ul>
        <li>Keep your menu, prices, opening hours and delivery areas correct. Customers see these and the AI uses them.</li>
        <li>Check and accept orders, and prepare and deliver them as promised. You are responsible for your food and your service.</li>
        <li>Keep staff logins private, and switch off staff who leave.</li>
        <li>Follow WhatsApp&apos;s and Meta&apos;s rules for business messaging.</li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>You must not use [APP_NAME] to send spam or marketing messages people did not ask for, to sell illegal products, to mislead customers, or to try to break or overload the service.</p>

      <h2>6. Data</h2>
      <ul>
        <li>Your restaurant and customer data belong to you. You can download it from Settings → Data &amp; privacy.</li>
        <li>You are responsible for having a good reason to collect your customers&apos; data and for handling their requests (for example, to delete their data).</li>
        <li>We process customer data only to run the service for you, as described in our privacy policy.</li>
      </ul>

      <h2>7. The AI assistant</h2>
      <p>
        The AI assistant takes orders using your menu. Prices and totals always come from your menu, and customers confirm every order. The AI can
        still misunderstand messages; you remain responsible for checking orders before you prepare them.
      </p>

      <h2>8. Availability</h2>
      <p>
        We work to keep [APP_NAME] running all the time, but we cannot promise it will never be down. WhatsApp and other services we depend on may
        also have problems. We are not responsible for losses caused by downtime beyond the fees you paid us for that month.
      </p>

      <h2>9. Cancellation</h2>
      <ul>
        <li>You can stop at any time by telling us. The service runs until the end of the month you paid for.</li>
        <li>We may suspend or end the service if these terms are broken or payment is not made.</li>
        <li>After cancellation you can ask for a copy of your data. We delete it after [90] days unless the law requires us to keep it.</li>
      </ul>

      <h2>10. Changes and contact</h2>
      <p>
        We may update these terms; we will tell you about important changes. Pakistani law applies. Contact: [EMAIL] · [PHONE].
      </p>
    </LegalPage>
  );
}
