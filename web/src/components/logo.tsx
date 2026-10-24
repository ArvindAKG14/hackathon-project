import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-xl font-bold">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect x="2" y="2" width="28" height="28" rx="8" className="fill-care" />
        <circle cx="12" cy="16" r="4" className="fill-on-care" />
        <circle cx="21" cy="16" r="4" className="fill-on-care opacity-60" />
      </svg>
      KinCare
    </Link>
  );
}
