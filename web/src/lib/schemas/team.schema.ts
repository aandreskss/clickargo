import { z } from "zod";

const ROLES = [
  "owner","admin","manager","operator",
  "finance","sales","customs_broker","viewer",
] as const;

export const InviteMemberSchema = z.object({
  email: z.string().email({ message: "Correo inválido." }),
  role:  z.enum(ROLES),
});

export const ChangeRoleSchema = z.object({
  membership_id: z.string().uuid(),
  role:          z.enum(ROLES),
});

export const ToggleCanSeeCostsSchema = z.object({
  membership_id: z.string().uuid(),
  can_see_costs: z.coerce.boolean(),
});

export const DeactivateMemberSchema = z.object({
  membership_id: z.string().uuid(),
});
