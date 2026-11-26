export type Role =
  | "owner" | "admin" | "manager" | "operator"
  | "finance" | "sales" | "customs_broker" | "viewer";

export type Module =
  | "quotes" | "shipments" | "masters" | "accounts"
  | "settings" | "reports" | "charges" | "pre_invoices" | "documents";

export type Action =
  | "view" | "create" | "edit" | "delete"
  | "view_costs" | "manage_team" | "manage_settings"
  | "link_shipments" | "manage_tracking" | "export"
  | "upload" | "send_email";

type Matrix = Partial<Record<Module, Action[]>>;

const P: Record<Role, Matrix> = {
  owner: {
    quotes:       ["view","create","edit","delete","view_costs"],
    shipments:    ["view","create","edit","delete","view_costs"],
    masters:      ["view","create","edit","delete","link_shipments","manage_tracking"],
    accounts:     ["view","create","edit","delete"],
    settings:     ["view","manage_team","manage_settings"],
    reports:      ["view"],
    charges:      ["view","create","edit","delete","view_costs","export"],
    pre_invoices: ["view","create","edit","delete","export"],
    documents:    ["view","upload","delete","send_email"],
  },
  admin: {
    quotes:       ["view","create","edit","delete","view_costs"],
    shipments:    ["view","create","edit","delete","view_costs"],
    masters:      ["view","create","edit","delete","link_shipments","manage_tracking"],
    accounts:     ["view","create","edit","delete"],
    settings:     ["view","manage_team","manage_settings"],
    reports:      ["view"],
    charges:      ["view","create","edit","delete","view_costs","export"],
    pre_invoices: ["view","create","edit","delete","export"],
    documents:    ["view","upload","delete","send_email"],
  },
  manager: {
    quotes:       ["view","create","edit","delete"],
    shipments:    ["view","create","edit","delete"],
    masters:      ["view","create","edit","delete","link_shipments","manage_tracking"],
    accounts:     ["view","create","edit","delete"],
    settings:     [],
    reports:      ["view"],
    charges:      ["view","create","edit","delete"],
    pre_invoices: ["view"],
    documents:    ["view","upload","delete","send_email"],
  },
  operator: {
    quotes:       ["view","create","edit"],
    shipments:    ["view","create","edit"],
    masters:      ["view","create","edit","link_shipments"],
    accounts:     ["view","create","edit"],
    settings:     [],
    reports:      [],
    charges:      ["view","create","edit"],
    pre_invoices: ["view"],
    documents:    ["view","upload"],
  },
  finance: {
    quotes:       ["view","view_costs"],
    shipments:    ["view","view_costs"],
    masters:      ["view"],
    accounts:     ["view"],
    settings:     [],
    reports:      ["view"],
    charges:      ["view","create","edit","delete","view_costs","export"],
    pre_invoices: ["view","create","edit","export"],
    documents:    ["view","send_email"],
  },
  sales: {
    quotes:       ["view","create","edit"],
    shipments:    ["view"],
    masters:      ["view"],
    accounts:     ["view","create","edit"],
    settings:     [],
    reports:      [],
    charges:      ["view"],
    pre_invoices: ["view"],
    documents:    ["view","upload","send_email"],
  },
  customs_broker: {
    quotes:       ["view"],
    shipments:    ["view","edit"],
    masters:      ["view"],
    accounts:     ["view"],
    settings:     [],
    reports:      [],
    charges:      ["view"],
    pre_invoices: [],
    documents:    ["view","upload"],
  },
  viewer: {
    quotes:       ["view"],
    shipments:    ["view"],
    masters:      ["view"],
    accounts:     ["view"],
    settings:     [],
    reports:      ["view"],
    charges:      ["view"],
    pre_invoices: ["view"],
    documents:    ["view"],
  },
};

export function can(role: Role, module: Module, action: Action): boolean {
  return P[role]?.[module]?.includes(action) ?? false;
}

export function canAny(role: Role, checks: { module: Module; action: Action }[]): boolean {
  return checks.some(({ module, action }) => can(role, module, action));
}

export const ROLE_LABELS: Record<Role, string> = {
  owner:          "Dueño",
  admin:          "Administrador",
  manager:        "Gerente",
  operator:       "Operador",
  finance:        "Finanzas",
  sales:          "Ventas",
  customs_broker: "Agente aduanal",
  viewer:         "Solo lectura",
};

export const ASSIGNABLE_ROLES: { value: Role; label: string }[] = [
  { value: "admin",          label: ROLE_LABELS.admin          },
  { value: "manager",        label: ROLE_LABELS.manager        },
  { value: "operator",       label: ROLE_LABELS.operator       },
  { value: "finance",        label: ROLE_LABELS.finance        },
  { value: "sales",          label: ROLE_LABELS.sales          },
  { value: "customs_broker", label: ROLE_LABELS.customs_broker },
  { value: "viewer",         label: ROLE_LABELS.viewer         },
];
