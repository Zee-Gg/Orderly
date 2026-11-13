import type { Metadata } from "next";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { LegalPage } from "@/components/public/public-chrome";
import { buttonVariants } from "@/components/ui/button";
import { waLink } from "@/lib/billing/core";
import { loadPublicPlatform } from "@/lib/public/platform";

export const metadata: Metadata = { title: "Contact" };

/** Contact page: WhatsApp (from platform settings), phone, email placeholder. */
export default async function ContactPage() {
  const { salesWhatsapp, supportPhone } = await loadPublicPlatform();
  const wa = waLink(salesWhatsapp, "Assalam o Alaikum! I have a question about Orderly.");
  return (
    <LegalPage title="Contact us" updated="[DATE]">
      <p>We usually reply within a few hours, 10 AM – 10 PM (Pakistan time).</p>
      <div className="flex flex-col gap-3">
        {wa ? (
          <a href={wa} target="_blank" rel="noreferrer" className={buttonVariants({ size: "lg" })}>
            <MessageCircle aria-hidden /> Message us on WhatsApp
          </a>
        ) : null}
        {supportPhone ? (
          <a href={`tel:${supportPhone}`} className={buttonVariants({ variant: "secondary", size: "lg" })}>
            <Phone aria-hidden /> {supportPhone}
          </a>
        ) : null}
        <p className="flex items-center gap-2">
          <Mail aria-hidden className="size-5 text-muted" /> [EMAIL]
        </p>
      </div>
      <h2>Are you a customer of a restaurant?</h2>
      <p>For questions about an order, please message the restaurant&apos;s own WhatsApp number. They can see your order and help you fastest.</p>
    </LegalPage>
  );
}
