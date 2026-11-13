"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button icon={<Printer />} onClick={() => window.print()} className="print:hidden">
      Print / Save as PDF
    </Button>
  );
}
