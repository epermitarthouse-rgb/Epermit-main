import { z } from "zod";
import type { ProjectRole } from "@/lib/governanceConstants";

export const ADMIN_CREATE_USER_MIN_PASSWORD = 8;

export const ASSIGNABLE_INITIAL_PROJECT_ROLES = ["viewer", "editor", "admin"] as const satisfies readonly ProjectRole[];

export const adminCreateUserSchema = z
  .object({
    fullName: z.string().trim().min(2, "Full name is required").max(100),
    email: z.string().trim().email("Enter a valid email address"),
    temporaryPassword: z
      .string()
      .min(
        ADMIN_CREATE_USER_MIN_PASSWORD,
        `Temporary password must be at least ${ADMIN_CREATE_USER_MIN_PASSWORD} characters`,
      ),
    companyName: z.string().trim().max(100).optional(),
    jobTitle: z.string().trim().max(100).optional(),
    projectId: z.string().trim().optional(),
    projectRole: z.enum(ASSIGNABLE_INITIAL_PROJECT_ROLES).optional(),
  })
  .superRefine((data, ctx) => {
    const hasProject = Boolean(data.projectId?.trim());
    const hasRole = Boolean(data.projectRole);
    if (hasProject !== hasRole) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select both a project and a role, or leave both empty",
        path: hasProject ? ["projectRole"] : ["projectId"],
      });
    }
  });

export type AdminCreateUserFormValues = z.infer<typeof adminCreateUserSchema>;

export function emptyAdminCreateUserForm(): AdminCreateUserFormValues {
  return {
    fullName: "",
    email: "",
    temporaryPassword: "",
    companyName: "",
    jobTitle: "",
    projectId: "",
    projectRole: undefined,
  };
}
