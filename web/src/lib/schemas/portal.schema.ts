import { z } from "zod";

export const InvitePortalSchema = z.object({
  account_id: z.string().uuid(),
  email:      z.string().email(),
});

export const AcceptInvitationSchema = z.object({
  token:    z.string().min(1),
  password: z.string().min(12),
});

export const LoginPortalSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

export const RevokePortalAccessSchema = z.object({
  membership_id: z.string().uuid(),
});

export const TrackingLinkSchema = z.object({
  shipment_id: z.string().uuid(),
});

export const NotificationPrefsSchema = z.object({
  account_id: z.string().uuid(),
  kind:       z.enum(["stage_changed", "eta_changed", "document_added"]),
  enabled:    z.coerce.boolean(),
  emails:     z.string().transform((s) =>
    s.split(",").map((e) => e.trim()).filter((e) => z.string().email().safeParse(e).success)
  ),
});
