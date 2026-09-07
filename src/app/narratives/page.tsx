import type { Metadata } from "next";
import SectionListing, { SECTIONS } from "@/components/SectionListing";

const def = SECTIONS.find(s => s.path === "narratives")!;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `The Sunland Tribune | ${def.title}`,
  description: def.description,
  alternates: { canonical: "/narratives" },
};

export default function Page() {
  return <SectionListing def={def} />;
}
