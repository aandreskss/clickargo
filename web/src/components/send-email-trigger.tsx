"use client";

import { useState } from "react";
import { Button, Dialog, Field } from "./ui";

type Props = {
  documentType: "quote" | "arrival_notice" | "pre_invoice";
  documentId: string;
  documentNumber: string;
  defaultEmail: string;
  pdfHref: string;
  action: (formData: FormData) => void | Promise<void>;
};

const SUBJECT_DEFAULTS: Record<Props["documentType"], string> = {
  quote:          "Cotización",
  arrival_notice: "Aviso de llegada",
  pre_invoice:    "Prefactura",
};

export function SendEmailTrigger({
  documentType, documentId, documentNumber, defaultEmail, pdfHref, action,
}: Props) {
  const [open, setOpen] = useState(false);

  const defaultSubject = `${SUBJECT_DEFAULTS[documentType]} ${documentNumber}`;

  return (
    <>
      <Button variant="ghost" type="button" onClick={() => setOpen(true)}>
        Enviar por correo
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Enviar por correo"
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <button
              form="send-email-form"
              type="submit"
              className="rounded-[var(--radius)] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--color-primary-hover)]"
            >
              Enviar
            </button>
          </>
        }
      >
        <form id="send-email-form" action={action} className="space-y-4">
          <input type="hidden" name="document_id" value={documentId} />
          <input type="hidden" name="document_type" value={documentType} />

          <Field
            label="Destinatario"
            name="to_email"
            type="email"
            placeholder="cliente@empresa.com"
            defaultValue={defaultEmail}
            required
          />
          <Field
            label="Asunto"
            name="subject"
            defaultValue={defaultSubject}
            required={false}
          />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[var(--color-text)]">
              Mensaje <span className="font-normal text-[var(--color-text-muted)]">(opcional)</span>
            </span>
            <textarea
              name="body"
              rows={3}
              placeholder="Adjunto encontrará el documento solicitado."
              className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-base text-[var(--color-text)] outline-none transition focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-border-focus)]/20"
            />
          </label>

          <a
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm text-[var(--color-primary)] underline underline-offset-2"
          >
            Ver PDF antes de enviar →
          </a>
        </form>
      </Dialog>
    </>
  );
}
