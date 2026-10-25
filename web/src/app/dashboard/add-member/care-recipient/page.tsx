import type { Metadata } from "next";
import { BackButton } from "@/components/back-button";
import { CareRecipientForm } from "@/components/care-recipient-form";

export const metadata: Metadata = { title: "Add a care recipient: KinCare" };

export default function CareRecipientSurveyPage() {
  return (
    <>
      <BackButton />
      <div className="mx-auto mt-6 flex w-full max-w-xl flex-col gap-8">
        <p className="rounded-2xl bg-lavender-tint px-5 py-4 text-lg leading-relaxed">
          If you are a recipient it is advised to consult your caretaker (possibly a family
          member) to assist you with this task.
        </p>
        <CareRecipientForm />
      </div>
    </>
  );
}
