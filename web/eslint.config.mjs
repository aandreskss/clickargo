import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // admin.ts contiene el cliente service_role. Prohibido importarlo desde
    // componentes, páginas o Server Actions de usuario. Ver docs/SEGURIDAD.md.
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@/lib/supabase/admin",
          message: "admin.ts solo puede importarse desde src/lib/ o scripts/. Ver docs/SEGURIDAD.md.",
        }],
      }],
      // Prohíbe dangerouslySetInnerHTML para evitar XSS.
      "react/no-danger": "error",
    },
  },
]);

export default eslintConfig;
