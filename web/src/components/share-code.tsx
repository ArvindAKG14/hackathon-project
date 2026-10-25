"use client";

import { useActionState } from "react";
import { createShareCode, redeemShareCode, type InviteState, type RedeemState } from "@/app/actions";

// The two halves of linking a family member to a senior. Both are deliberately
// plain forms: the people using this are often not the family's technical one.

const REDEEM_INITIAL: RedeemState = { status: "idle", message: "" };
const INVITE_INITIAL: InviteState = { code: null, message: "" };

/** Enter a code someone shared with you. */
export function RedeemShareCode() {
  const [state, action, pending] = useActionState(redeemShareCode, REDEEM_INITIAL);

  return (
    <div className="rounded-2xl border-2 border-line bg-surface p-5 sm:p-6">
      <h2 className="text-2xl font-bold">Have a share code?</h2>
      <p className="mt-1 text-ink-soft">
        A family member who already uses KinCare can give you one. It connects you to the
        person they look after.
      </p>
      <form action={action} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="code" className="sr-only">
          Share code
        </label>
        <input
          id="code"
          name="code"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="K7M2-9QX4"
          className="w-full rounded-xl border-2 border-line bg-paper px-4 py-3 text-lg tracking-widest uppercase placeholder:tracking-normal placeholder:normal-case focus:border-care focus:outline-none sm:max-w-56"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-care px-7 py-3 text-lg font-bold whitespace-nowrap text-on-care hover:bg-care-strong disabled:opacity-60"
        >
          {pending ? "Connecting…" : "Connect"}
        </button>
      </form>
      {state.status !== "idle" && (
        <p
          role="status"
          className={`mt-3 text-lg font-bold ${state.status === "ok" ? "text-care-strong" : "text-rose"}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

/** Create a code to give someone else access to this senior. */
export function CreateShareCode({ seniorId, seniorName }: { seniorId: string; seniorName: string }) {
  const [state, action, pending] = useActionState(createShareCode, INVITE_INITIAL);
  const firstName = seniorName.split(" ")[0];

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-2xl font-bold">Invite a family member</h2>
      <p className="mt-1 text-ink-soft">
        Give them a code and they&apos;ll be able to see {firstName}&apos;s readings too.
      </p>
      <form action={action} className="mt-4">
        <input type="hidden" name="seniorId" value={seniorId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border-2 border-care px-7 py-3 text-lg font-bold text-care-strong hover:bg-mist disabled:opacity-60"
        >
          {pending ? "Creating…" : state.code ? "Create another code" : "Create a share code"}
        </button>
      </form>
      {state.code && (
        <p className="mt-4 rounded-xl bg-mist px-5 py-4 text-center text-3xl font-bold tracking-[0.2em] tabular-nums">
          {state.code}
        </p>
      )}
      {state.message && <p className="mt-2 text-ink-soft">{state.message}</p>}
    </div>
  );
}
