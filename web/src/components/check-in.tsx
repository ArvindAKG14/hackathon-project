"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// The senior's side of a check-in: a banner on their page that opens a
// full-screen voice conversation, then sends a short note to the family.
//
// Speech in and out both use the browser's built-in engines, so there is no
// extra service or key. Where speech recognition isn't available (Firefox),
// the senior types instead; where speech synthesis isn't, they read.

type Message = { from: "senior" | "assistant"; text: string };
type Emergency = "medical" | "self_harm";
type Phase = "speaking" | "listening" | "thinking" | "idle" | "finishing" | "done";

// Minimal shape of the Web Speech API; not every browser ships the types.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** A clear, unhurried voice if the device has one. */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const lang = navigator.language.slice(0, 2);
  const local = voices.filter((v) => v.lang.startsWith(lang));
  return (
    local.find((v) => /natural|neural|enhanced|premium/i.test(v.name)) ??
    local.find((v) => /google|samantha|daniel|karen/i.test(v.name)) ??
    local[0]
  );
}

const STATUS: Record<Phase, string> = {
  speaking: "Speaking…",
  listening: "Listening…",
  thinking: "Thinking…",
  idle: "Tap the circle to talk",
  finishing: "Writing a note for your family…",
  done: "",
};

/** Ends the turn after the senior's last long pause, for long answers on continuous engines. */
const MAX_LISTEN_MS = 30_000;

export function CheckIn({
  seniorId,
  firstName,
  greeting,
}: {
  seniorId: string;
  firstName: string;
  greeting: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-5 rounded-2xl border-2 border-care bg-mist px-5 py-5 text-left hover:bg-surface sm:px-6"
      >
        <span aria-hidden className="relative h-14 w-14 shrink-0">
          <span className="absolute inset-0 rounded-full bg-care opacity-25" />
          <span className="absolute inset-2 rounded-full bg-care" />
        </span>
        <span>
          <span className="block text-2xl font-bold">Talk to KinCare</span>
          <span className="mt-1 block text-lg leading-snug text-ink-soft">
            {firstName}, tap here to tell me how you&apos;re feeling. I&apos;ll pass a short note to your family.
          </span>
        </span>
      </button>
      {open && (
        <Conversation seniorId={seniorId} firstName={firstName} greeting={greeting} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function Conversation({
  seniorId,
  firstName,
  greeting,
  onClose,
}: {
  seniorId: string;
  firstName: string;
  greeting: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([{ from: "assistant", text: greeting }]);
  const [phase, setPhase] = useState<Phase>("speaking");
  const [caption, setCaption] = useState(greeting);
  const [heard, setHeard] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [emergency, setEmergency] = useState<Emergency | null>(null);
  const [typing, setTyping] = useState(() => recognitionClass() === null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [startedAt] = useState(() => new Date().toISOString());

  // Callbacks below are created once and outlive renders, so anything they
  // need to read fresh lives in a ref. Every setMessages also updates this.
  const messagesRef = useRef<Message[]>([{ from: "assistant", text: greeting }]);
  const recognition = useRef<Recognition | null>(null);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hands-free once they've spoken: after each reply, listen again.
  const voiceMode = useRef(recognitionClass() !== null);
  const sent = useRef(false);
  // Bumped on every stop. cancel() fires the utterance's onerror, which must
  // not then run "after speaking" for a line we deliberately cut off.
  const speechGeneration = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const stopAudio = useCallback(() => {
    speechGeneration.current++;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    window.speechSynthesis?.cancel();
    recognition.current?.abort();
    recognition.current = null;
  }, []);

  const listen = useCallback(() => {
    const Rec = recognitionClass();
    if (!Rec) {
      setTyping(true);
      setPhase("idle");
      return;
    }
    stopAudio();
    const rec = new Rec();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    const giveUp = setTimeout(() => rec.stop(), MAX_LISTEN_MS);

    rec.onresult = (e) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalText += r[0]!.transcript;
        else interim += r[0]!.transcript;
      }
      setHeard((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        voiceMode.current = false;
        setTyping(true);
        setNotice("The microphone is turned off for this site, so let's type instead.");
      } else if (e.error === "no-speech") {
        setNotice("I didn't hear anything. Tap the circle and try again.");
      }
    };
    rec.onend = () => {
      clearTimeout(giveUp);
      if (recognition.current !== rec) return; // superseded or cancelled
      recognition.current = null;
      const text = finalText.trim();
      if (text) void send(text);
      else setPhase("idle");
    };

    recognition.current = rec;
    setHeard("");
    setNotice(null);
    setPhase("listening");
    rec.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send is stable enough; it reads refs
  }, [stopAudio]);

  /** Audio only; the caller sets the caption and phase. */
  const voice = useCallback(
    (text: string, after: () => void) => {
      stopAudio();
      // Some browsers never fire onend for long text, so a timer backs it up.
      const estimate = text.split(/\s+/).length * 420 + 1500;
      const generation = speechGeneration.current;
      let finished = false;
      const done = () => {
        if (finished || generation !== speechGeneration.current) return;
        finished = true;
        if (speechTimer.current) clearTimeout(speechTimer.current);
        after();
      };
      speechTimer.current = setTimeout(done, window.speechSynthesis ? estimate + 4000 : estimate);
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.92;
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    },
    [stopAudio],
  );

  const speak = useCallback(
    (text: string, after: () => void) => {
      setCaption(text);
      setPhase("speaking");
      voice(text, after);
    },
    [voice],
  );

  const afterSpeaking = useCallback(() => {
    if (voiceMode.current) listen();
    else setPhase("idle");
  }, [listen]);

  async function send(text: string) {
    const next: Message[] = [...messagesRef.current, { from: "senior", text }];
    setMessages(next);
    messagesRef.current = next;
    setHeard("");
    setPhase("thinking");
    try {
      const res = await fetch(`/api/seniors/${seniorId}/check-in/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "No reply");
      const withReply: Message[] = [...next, { from: "assistant", text: body.reply }];
      setMessages(withReply);
      messagesRef.current = withReply;
      if (body.emergency) setEmergency(body.emergency);
      speak(body.reply, afterSpeaking);
    } catch {
      // Not added to the conversation: the model never said it.
      speak("Sorry, I didn't catch that. Could you say it again?", afterSpeaking);
    }
  }

  async function finish() {
    stopAudio();
    setPhase("finishing");
    setNotice(null);
    try {
      const res = await fetch(`/api/seniors/${seniorId}/check-in/finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: messagesRef.current, startedAt }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Couldn't send");
      sent.current = true;
      setNote(body.summary);
      setPhase("done");
      // Spoken directly rather than through speak(), which would flip the
      // screen back to the orb while it talks.
      if (window.speechSynthesis) {
        const thanks = new SpeechSynthesisUtterance(`Thank you, ${firstName}. I've sent a note to your family.`);
        thanks.rate = 0.92;
        const voice = pickVoice();
        if (voice) thanks.voice = voice;
        window.speechSynthesis.speak(thanks);
      }
      router.refresh();
    } catch (error) {
      setPhase("idle");
      setNotice(error instanceof Error ? error.message : "Couldn't send the note. Try Finish again.");
    }
  }

  function close() {
    const spoke = messagesRef.current.some((m) => m.from === "senior");
    if (spoke && !sent.current && !window.confirm("Close without sending a note to your family?")) return;
    stopAudio();
    onClose();
  }

  function onOrb() {
    if (phase === "listening") recognition.current?.stop();
    else if (phase === "speaking" || phase === "idle") {
      voiceMode.current = true;
      setTyping(false);
      listen();
    }
  }

  // Open with the greeting. The tap that opened this counts as the user
  // gesture browsers require before speaking.
  // The first render already shows the greeting in the speaking state.
  useEffect(() => {
    voice(greeting, afterSpeaking);
    return stopAudio;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  // Full-screen: no page scroll behind it, Escape closes, focus starts inside.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close reads refs
  }, []);

  const seniorTurns = messages.filter((m) => m.from === "senior").length;
  const busy = phase === "thinking" || phase === "finishing";
  const full = messages.length >= 58;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="check-in-title"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-paper"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-6 pt-5">
        <div className="flex items-center justify-between">
          <h2 id="check-in-title" className="text-xl font-bold">
            Check-in with {firstName}
          </h2>
          <button
            type="button"
            onClick={close}
            className="rounded-full border-2 border-line px-4 py-1.5 font-bold hover:border-care"
          >
            Close
          </button>
        </div>

        {emergency && (
          <div role="alert" className="mt-5 rounded-2xl border-2 border-rose bg-rose-tint px-5 py-4">
            <p className="text-lg font-bold">
              {emergency === "self_harm" ? "You don't have to go through this alone." : "This may need help right away."}
            </p>
            <p className="mt-1 text-lg">Your family has been sent an alert.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {emergency === "self_harm" && (
                <a href="tel:988" className="rounded-full bg-rose px-6 py-3 text-lg font-bold text-surface">
                  Call or text 988
                </a>
              )}
              <a href="tel:911" className="rounded-full bg-rose px-6 py-3 text-lg font-bold text-surface">
                Call 911
              </a>
            </div>
          </div>
        )}

        {phase === "done" && note ? (
          <div className="mt-10 flex flex-1 flex-col">
            <p className="text-3xl font-bold leading-tight">Thank you, {firstName}.</p>
            <p className="mt-3 text-xl text-ink-soft">This is the note your family will see:</p>
            <blockquote className="mt-5 rounded-2xl border-2 border-line bg-surface px-5 py-5 text-xl leading-relaxed">
              {note}
            </blockquote>
            <button
              type="button"
              onClick={() => {
                stopAudio();
                onClose();
              }}
              className="mt-8 self-start rounded-full bg-care px-8 py-4 text-xl font-bold text-on-care hover:bg-care-strong"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6">
              <button
                type="button"
                onClick={onOrb}
                disabled={busy}
                aria-label={phase === "listening" ? "Stop listening" : "Tap to talk"}
                className="orb rounded-full disabled:cursor-wait"
                data-state={phase === "finishing" ? "thinking" : phase}
              >
                <span className="orb-ring" style={{ "--speed": "0.9s", "--to": 1.18 } as React.CSSProperties} />
                <span className="orb-ring" style={{ "--speed": "1.3s", "--to": 1.3 } as React.CSSProperties} />
                <span className="orb-ring" style={{ "--speed": "1.7s", "--to": 1.42 } as React.CSSProperties} />
                <span className="orb-core" />
              </button>
              <p aria-live="polite" className="text-lg font-bold text-care-strong">
                {STATUS[phase]}
              </p>
              <p aria-live="polite" className="min-h-[5rem] max-w-xl text-center text-2xl leading-snug">
                {phase === "listening" && heard ? <span className="text-ink-soft">{heard}</span> : caption}
              </p>
              {notice && <p className="max-w-xl text-center text-lg text-marigold">{notice}</p>}
            </div>

            {typing && (
              <form
                className="flex gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = draft.trim();
                  if (!text || busy || full) return;
                  setDraft("");
                  voiceMode.current = false;
                  setNotice(null);
                  void send(text);
                }}
              >
                <label htmlFor="check-in-text" className="sr-only">
                  Type your answer
                </label>
                <input
                  id="check-in-text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={1000}
                  autoComplete="off"
                  placeholder="Type your answer"
                  className="min-w-0 flex-1 rounded-full border-2 border-line bg-surface px-5 py-3 text-lg focus:border-care"
                />
                <button
                  type="submit"
                  disabled={busy || full || !draft.trim()}
                  className="rounded-full bg-care px-6 py-3 text-lg font-bold text-on-care disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              {recognitionClass() ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = !typing;
                    setTyping(next);
                    voiceMode.current = !next;
                    if (next) {
                      stopAudio();
                      setPhase("idle");
                    }
                  }}
                  className="rounded-full px-4 py-2 text-lg font-bold text-care-strong underline underline-offset-4"
                >
                  {typing ? "Talk instead" : "Type instead"}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={finish}
                disabled={busy || seniorTurns === 0}
                className="rounded-full bg-care px-8 py-4 text-xl font-bold text-on-care hover:bg-care-strong disabled:opacity-50"
              >
                Finish
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
