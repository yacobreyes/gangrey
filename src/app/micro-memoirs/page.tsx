import type { Metadata } from "next";
import SectionListing, { SECTIONS } from "@/components/SectionListing";

const def = SECTIONS.find(s => s.path === "micro-memoirs")!;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Gangrey | ${def.title}`,
  description: def.description,
  alternates: { canonical: "/micro-memoirs" },
};

export default function Page() {
  return <SectionListing def={def} />;
}
