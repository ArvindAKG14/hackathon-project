import { Suspense } from "react";
import { signOut } from "@/app/actions";
import { Logo } from "@/components/logo";
import { getCurrentCaregiver } from "@/lib/session";

async function UserMenu() {
  const caregiver = await getCurrentCaregiver();
  return (
    <div className="flex items-center gap-4">
      <span className="hidden text-ink-soft sm:inline">{caregiver.full_name}</span>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-full border-2 border-line px-4 py-1.5 font-bold hover:border-care"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
          <Logo />
          <Suspense>
            <UserMenu />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-8 sm:px-8">{children}</main>
    </>
  );
}
